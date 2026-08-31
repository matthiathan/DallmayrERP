/*
  Dallmayr South Africa - Air780EU Cellular Diagnostic V6.8.30

  PURPOSE
  -------
  Isolate the cellular stack from the production telemetry firmware.

  This sketch intentionally contains NO:
    - MDB / DEX
    - Wi-Fi
    - Supabase authentication or telemetry upload
    - enrollment / NVS provisioning
    - USSD / balance checks
    - background reconnect loop

  It performs one controlled cellular test:
    1. Recover Air780EU AT command mode if a previous PPP session survived.
    2. Prove SIM, LTE registration, APN/PDP state and modem firmware.
    3. Create exactly one raw lwIP PPPoS interface.
    4. Configure PPP to mirror OpenLuat's reference pppd profile:
         - blank PAP credentials
         - accept peer-selected local/remote IPv4 addresses
         - no preset/default IPv4 address
         - peer DNS
         - no Van Jacobson compression
         - no CCP compression options
    5. Dial ATD*99# once.
    6. Trace LCP/PAP/IPCP/CCP control frames in both directions.
    7. Allow up to 120 seconds for IPCP (the production firmware previously
       aborted at 30 seconds while the link was still in NETWORK/IPCP).
    8. If PPP reaches RUNNING, test DNS, TCP:443 and TLS to the Supabase host.

  Hardware:
    Air780EU TX -> ESP32-S3 GPIO1
    Air780EU RX <- ESP32-S3 GPIO2
    Air780EU must have its own adequate 5 V supply and common logic ground.
*/

#include <Arduino.h>
#include <HardwareSerial.h>
#include <NetworkClient.h>
#include <NetworkClientSecure.h>
#include <lwip/netdb.h>
#include <lwip/dns.h>
#include <lwip/tcpip.h>
#include <lwip/inet.h>
#include <lwip/opt.h>
#include <netif/ppp/ppp.h>
#include <netif/ppp/pppos.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const uint8_t CELL_RX_PIN = 1;   // ESP32 RX <- Air780EU TX
static const uint8_t CELL_TX_PIN = 2;   // ESP32 TX -> Air780EU RX
static const uint32_t CELL_BAUD = 115200;
static const char* APN = "internet";
static const char* TEST_HOST = "egbiiizxsqlarqpnzxxs.supabase.co";
static const uint16_t TEST_PORT = 443;
static const uint32_t PPP_NEGOTIATION_TIMEOUT_MS = 120000UL;

HardwareSerial CellSerial(1);

static struct netif pppNetif;
static ppp_pcb* pppPcb = nullptr;
static TaskHandle_t pppRxTaskHandle = nullptr;
static volatile bool pppRxTaskRun = false;
static volatile bool pppOnline = false;
static volatile u8_t pppPhase = PPP_PHASE_DEAD;
static volatile int pppLastError = PPPERR_NONE;
static volatile uint64_t pppTxBytes = 0;
static volatile uint64_t pppRxBytes = 0;
static char pppIp[20] = {0};
static char pppPeerIp[20] = {0};

struct PppTraceState {
  bool inFrame = false;
  bool escaped = false;
  uint8_t frame[512];
  size_t len = 0;
};

static PppTraceState txTrace;
static PppTraceState rxTrace;

const char* phaseName(u8_t phase) {
  switch (phase) {
    case PPP_PHASE_DEAD: return "DEAD";
    case PPP_PHASE_HOLDOFF: return "HOLDOFF";
    case PPP_PHASE_INITIALIZE: return "INITIALIZE";
    case PPP_PHASE_ESTABLISH: return "ESTABLISH/LCP";
    case PPP_PHASE_AUTHENTICATE: return "AUTHENTICATE/PAP";
    case PPP_PHASE_CALLBACK: return "CALLBACK";
    case PPP_PHASE_NETWORK: return "NETWORK/IPCP";
    case PPP_PHASE_RUNNING: return "RUNNING";
    case PPP_PHASE_TERMINATE: return "TERMINATE";
    case PPP_PHASE_DISCONNECT: return "DISCONNECT";
    case PPP_PHASE_MASTER: return "MASTER";
    default: return "UNKNOWN";
  }
}

const char* pppErrorName(int err) {
  switch (err) {
    case PPPERR_NONE: return "NONE";
    case PPPERR_PARAM: return "PARAM";
    case PPPERR_OPEN: return "OPEN";
    case PPPERR_DEVICE: return "DEVICE";
    case PPPERR_ALLOC: return "ALLOC";
    case PPPERR_USER: return "USER";
    case PPPERR_CONNECT: return "CONNECT";
    case PPPERR_AUTHFAIL: return "AUTHFAIL";
    case PPPERR_PROTOCOL: return "PROTOCOL";
    case PPPERR_PEERDEAD: return "PEERDEAD";
    case PPPERR_IDLETIMEOUT: return "IDLETIMEOUT";
    case PPPERR_CONNECTTIME: return "CONNECTTIME";
    case PPPERR_LOOPBACK: return "LOOPBACK";
    default: return "UNKNOWN";
  }
}

void drainCell() {
  while (CellSerial.available()) CellSerial.read();
}

String readCell(uint32_t timeoutMs, bool stopOnTerminal = true) {
  String out;
  uint32_t start = millis();
  uint32_t lastByte = start;

  while (millis() - start < timeoutMs) {
    while (CellSerial.available()) {
      char c = static_cast<char>(CellSerial.read());
      out += c;
      lastByte = millis();

      if (stopOnTerminal) {
        // Do not stop merely because the modem echoed our command. Air780EU can
        // echo immediately and return the final result later, especially when
        // waking from a low-power or just-escaped PPP state.
        String normalized = out;
        normalized.replace("\r", "\n");
        if (normalized.indexOf("\nOK\n") >= 0 ||
            normalized.indexOf("\nERROR\n") >= 0 ||
            normalized.indexOf("+CME ERROR:") >= 0 ||
            normalized.indexOf("NO CARRIER") >= 0 ||
            normalized.indexOf("CONNECT") >= 0) {
          return out;
        }
      }
    }

    // For free-form captures such as the +++ escape response, an idle gap is a
    // valid end condition. For AT commands we must keep waiting for a terminal
    // result or the full timeout.
    if (!stopOnTerminal && out.length() && millis() - lastByte > 500) break;
    delay(2);
  }
  return out;
}

String atQuery(const String& command, uint32_t timeoutMs = 3000) {
  drainCell();
  CellSerial.print(command);
  CellSerial.print("\r\n");
  String response = readCell(timeoutMs);
  Serial.print(F("[AT] "));
  Serial.println(command);
  Serial.print(response);
  if (!response.endsWith("\n")) Serial.println();
  return response;
}

bool responseHasOk(String response) {
  response.replace("\r", "\n");
  return response.indexOf("\nOK\n") >= 0 || response.endsWith("\nOK");
}

bool atOk(const String& command, uint32_t timeoutMs = 3000) {
  String response = atQuery(command, timeoutMs);
  return responseHasOk(response);
}

bool probeAt(uint8_t attempts = 1, uint32_t timeoutMs = 2500) {
  for (uint8_t i = 0; i < attempts; ++i) {
    String response = atQuery("AT", timeoutMs);
    if (responseHasOk(response)) {
      if (i > 0) {
        Serial.print(F("[WAKE] Modem answered AT on attempt "));
        Serial.println(i + 1);
      }
      return true;
    }
    delay(400);
  }
  return false;
}

bool recoverCommandMode() {
  Serial.println(F("[RECOVERY] Guarded +++ / ATH command-mode recovery."));
  drainCell();
  delay(1200);
  CellSerial.print("+++");
  CellSerial.flush();
  delay(700);
  String escape = readCell(1800, false);
  if (escape.length()) {
    Serial.print(F("[RECOVERY] escape response: "));
    Serial.println(escape);
  }

  drainCell();
  CellSerial.print("ATH\r\n");
  String hangup = readCell(2500);
  Serial.print(F("[RECOVERY] ATH response: "));
  Serial.println(hangup);

  // Give the modem time to complete the PPP hang-up internally, then send a
  // wake/probe burst. OpenLuat notes that low-power modules may require more
  // than one AT command before responding.
  delay(1500);
  bool recovered = probeAt(5, 3000);
  Serial.println(recovered
    ? F("[RECOVERY] Command mode confirmed.")
    : F("[RECOVERY] Command mode still not confirmed after 5 AT probes."));
  return recovered;
}

void printIp4(const uint8_t* p) {
  Serial.print(p[0]); Serial.print('.');
  Serial.print(p[1]); Serial.print('.');
  Serial.print(p[2]); Serial.print('.');
  Serial.print(p[3]);
}

const char* ctrlCodeName(uint8_t code) {
  switch (code) {
    case 1: return "CONF-REQ";
    case 2: return "CONF-ACK";
    case 3: return "CONF-NAK";
    case 4: return "CONF-REJ";
    case 5: return "TERM-REQ";
    case 6: return "TERM-ACK";
    case 7: return "CODE-REJ";
    case 8: return "PROTO-REJ";
    case 9: return "ECHO-REQ";
    case 10: return "ECHO-REP";
    default: return "CODE";
  }
}

void traceIpcpOptions(const uint8_t* p, size_t len) {
  size_t i = 0;
  while (i + 2 <= len) {
    uint8_t type = p[i];
    uint8_t optLen = p[i + 1];
    if (optLen < 2 || i + optLen > len) break;

    Serial.print(F("    option "));
    switch (type) {
      case 2:
        Serial.print(F("VJ-COMPRESSION"));
        if (optLen >= 4) {
          uint16_t proto = (static_cast<uint16_t>(p[i + 2]) << 8) | p[i + 3];
          Serial.print(F(" protocol=0x"));
          Serial.print(proto, HEX);
        }
        break;
      case 3:
        Serial.print(F("IP-ADDRESS="));
        if (optLen >= 6) printIp4(&p[i + 2]);
        break;
      case 129:
        Serial.print(F("DNS1="));
        if (optLen >= 6) printIp4(&p[i + 2]);
        break;
      case 131:
        Serial.print(F("DNS2="));
        if (optLen >= 6) printIp4(&p[i + 2]);
        break;
      default:
        Serial.print(F("type="));
        Serial.print(type);
        Serial.print(F(" len="));
        Serial.print(optLen);
        break;
    }
    Serial.println();
    i += optLen;
  }
}

void traceControlFrame(const char* direction, const uint8_t* frame, size_t len) {
  if (len < 4) return;

  size_t i = 0;
  if (len >= 2 && frame[0] == 0xFF && frame[1] == 0x03) i = 2;
  if (i >= len) return;

  uint16_t protocol = 0;
  if (frame[i] & 0x01) {
    protocol = frame[i++];
  } else {
    if (i + 1 >= len) return;
    protocol = (static_cast<uint16_t>(frame[i]) << 8) | frame[i + 1];
    i += 2;
  }

  // Ignore normal IPv4 payload; this diagnostic focuses on control negotiation.
  if (protocol == 0x0021) return;

  if (i + 4 > len) return;
  uint8_t code = frame[i];
  uint8_t id = frame[i + 1];
  uint16_t ctrlLen = (static_cast<uint16_t>(frame[i + 2]) << 8) | frame[i + 3];
  if (ctrlLen < 4) return;
  size_t availableCtrl = len - i;
  if (ctrlLen > availableCtrl) ctrlLen = availableCtrl;

  if (protocol == 0xC021) {
    Serial.print(F("[PPP "));
    Serial.print(direction);
    Serial.print(F("] LCP "));
    Serial.print(ctrlCodeName(code));
    Serial.print(F(" id="));
    Serial.println(id);
    return;
  }

  if (protocol == 0xC023) {
    Serial.print(F("[PPP "));
    Serial.print(direction);
    Serial.print(F("] PAP "));
    Serial.print(code == 1 ? "AUTH-REQ" : code == 2 ? "AUTH-ACK" : code == 3 ? "AUTH-NAK" : "CODE");
    Serial.print(F(" id="));
    Serial.println(id);
    return;
  }

  if (protocol == 0x8021) {
    Serial.print(F("[PPP "));
    Serial.print(direction);
    Serial.print(F("] IPCP "));
    Serial.print(ctrlCodeName(code));
    Serial.print(F(" id="));
    Serial.println(id);
    if (ctrlLen > 4) traceIpcpOptions(&frame[i + 4], ctrlLen - 4);
    return;
  }

  if (protocol == 0x80FD) {
    Serial.print(F("[PPP "));
    Serial.print(direction);
    Serial.print(F("] CCP "));
    Serial.print(ctrlCodeName(code));
    Serial.print(F(" id="));
    Serial.println(id);
    return;
  }

  if (protocol == 0x8057) {
    Serial.print(F("[PPP "));
    Serial.print(direction);
    Serial.println(F("] IPV6CP control frame"));
  }
}

void tracePppBytes(PppTraceState& state, const char* direction, const uint8_t* data, size_t len) {
  for (size_t n = 0; n < len; ++n) {
    uint8_t b = data[n];

    if (b == 0x7E) {
      if (state.inFrame && state.len >= 4) {
        // Last two bytes are normally FCS. The control length field prevents
        // them from being parsed as options, so no explicit FCS verification
        // is required for this diagnostic trace.
        traceControlFrame(direction, state.frame, state.len);
      }
      state.inFrame = true;
      state.escaped = false;
      state.len = 0;
      continue;
    }

    if (!state.inFrame) continue;

    if (state.escaped) {
      b ^= 0x20;
      state.escaped = false;
    } else if (b == 0x7D) {
      state.escaped = true;
      continue;
    }

    if (state.len < sizeof(state.frame)) {
      state.frame[state.len++] = b;
    } else {
      state.inFrame = false;
      state.len = 0;
      state.escaped = false;
    }
  }
}

static u32_t pppOutput(ppp_pcb* pcb, const void* data, u32_t len, void* ctx) {
  (void)pcb;
  (void)ctx;
  if (!data || len == 0) return 0;
  const uint8_t* bytes = static_cast<const uint8_t*>(data);
  tracePppBytes(txTrace, "TX", bytes, len);
  size_t written = CellSerial.write(bytes, len);
  pppTxBytes += written;
  return static_cast<u32_t>(written);
}

#if PPP_NOTIFY_PHASE
static void pppPhaseCallback(ppp_pcb* pcb, u8_t phase, void* ctx) {
  (void)pcb;
  (void)ctx;
  pppPhase = phase;
  Serial.print(F("[PPP PHASE] "));
  Serial.println(phaseName(phase));
}
#endif

static void pppStatusCallback(ppp_pcb* pcb, int errCode, void* ctx) {
  (void)ctx;
  pppLastError = errCode;

  if (errCode == PPPERR_NONE) {
    struct netif* nif = ppp_netif(pcb);
    if (nif != nullptr) {
      char local[20] = {0};
      char peer[20] = {0};
      ip4addr_ntoa_r(netif_ip4_addr(nif), local, sizeof(local));
      ip4addr_ntoa_r(netif_ip4_gw(nif), peer, sizeof(peer));
      strncpy(pppIp, local, sizeof(pppIp) - 1);
      strncpy(pppPeerIp, peer, sizeof(pppPeerIp) - 1);
      netif_set_default(nif);
    }
    pppOnline = true;
    Serial.print(F("[PPP STATUS] UP local="));
    Serial.print(pppIp);
    Serial.print(F(" peer/gw="));
    Serial.println(pppPeerIp);

#if LWIP_DNS
    const ip_addr_t* dns1 = dns_getserver(0);
    const ip_addr_t* dns2 = dns_getserver(1);
    Serial.print(F("[PPP STATUS] DNS1="));
    Serial.println(ipaddr_ntoa(dns1));
    Serial.print(F("[PPP STATUS] DNS2="));
    Serial.println(ipaddr_ntoa(dns2));
#endif
    return;
  }

  pppOnline = false;
  Serial.print(F("[PPP STATUS] DOWN err="));
  Serial.print(errCode);
  Serial.print(' ');
  Serial.print(pppErrorName(errCode));
  Serial.print(F(" phase="));
  Serial.println(phaseName(pppPhase));
}

static void pppRxTask(void* parameter) {
  (void)parameter;
  uint8_t buffer[512];

  while (pppRxTaskRun) {
    int available = CellSerial.available();
    if (available <= 0) {
      vTaskDelay(pdMS_TO_TICKS(1));
      continue;
    }

    size_t wanted = static_cast<size_t>(available);
    if (wanted > sizeof(buffer)) wanted = sizeof(buffer);
    size_t received = CellSerial.readBytes(buffer, wanted);
    if (received > 0) {
      pppRxBytes += received;
      tracePppBytes(rxTrace, "RX", buffer, received);
      if (pppPcb) pppos_input_tcpip(pppPcb, buffer, static_cast<int>(received));
    }
  }

  pppRxTaskHandle = nullptr;
  vTaskDelete(nullptr);
}

bool createPpp() {
  memset(&pppNetif, 0, sizeof(pppNetif));
  pppPhase = PPP_PHASE_DEAD;
  pppLastError = PPPERR_NONE;
  pppIp[0] = '\0';
  pppPeerIp[0] = '\0';

  LOCK_TCPIP_CORE();
  pppPcb = pppos_create(&pppNetif, pppOutput, pppStatusCallback, nullptr);
  if (pppPcb != nullptr) {
    ppp_set_usepeerdns(pppPcb, 1);
#if PAP_SUPPORT
    ppp_set_auth(pppPcb, PPPAUTHTYPE_PAP, "", "");
#endif
#if PPP_NOTIFY_PHASE
    ppp_set_notify_phase_callback(pppPcb, pppPhaseCallback);
#endif

#if PPP_IPV4_SUPPORT
    // Mirror the OpenLuat pppd client profile:
    // ipcp-accept-local / ipcp-accept-remote / noipdefault
    pppPcb->ipcp_wantoptions.ouraddr = 0;
    pppPcb->ipcp_wantoptions.hisaddr = 0;
    pppPcb->ipcp_wantoptions.accept_local = 1;
    pppPcb->ipcp_wantoptions.accept_remote = 1;
    pppPcb->ask_for_local = 1;

#if VJ_SUPPORT
    // novj / novjccomp
    pppPcb->ipcp_wantoptions.neg_vj = 0;
    pppPcb->ipcp_wantoptions.old_vj = 0;
    pppPcb->ipcp_wantoptions.cflag = 0;
    pppPcb->ipcp_allowoptions.neg_vj = 0;
    pppPcb->ipcp_allowoptions.old_vj = 0;
    pppPcb->ipcp_allowoptions.cflag = 0;
#endif
#endif

#if CCP_SUPPORT
    // noccp-equivalent for the options available in lwIP's per-PCB state.
    memset(&pppPcb->ccp_wantoptions, 0, sizeof(pppPcb->ccp_wantoptions));
    memset(&pppPcb->ccp_allowoptions, 0, sizeof(pppPcb->ccp_allowoptions));
#endif
  }
  UNLOCK_TCPIP_CORE();

  if (!pppPcb) {
    Serial.println(F("[FAIL] pppos_create returned null."));
    return false;
  }

  Serial.println(F("[PPP CONFIG] PAP blank/blank"));
  Serial.println(F("[PPP CONFIG] usepeerdns=1"));
  Serial.println(F("[PPP CONFIG] ipcp-accept-local=1"));
  Serial.println(F("[PPP CONFIG] ipcp-accept-remote=1"));
  Serial.println(F("[PPP CONFIG] local/remote requested IP=0.0.0.0"));
#if VJ_SUPPORT
  Serial.println(F("[PPP CONFIG] novj + novjccomp"));
#endif
#if CCP_SUPPORT
  Serial.println(F("[PPP CONFIG] CCP compression options disabled"));
#endif
  return true;
}

bool dialPpp() {
  drainCell();
  Serial.println(F("[DIAL] ATD*99#"));
  CellSerial.print("ATD*99#\r");

  uint32_t start = millis();
  String response;
  while (millis() - start < 15000UL) {
    while (CellSerial.available()) {
      char c = static_cast<char>(CellSerial.read());
      response += c;
      if (response.indexOf("CONNECT") >= 0) {
        Serial.print(F("[DIAL] "));
        Serial.println(response);
        return true;
      }
      if (response.indexOf("NO CARRIER") >= 0 ||
          response.indexOf("\r\nERROR\r\n") >= 0 ||
          response.indexOf("+CME ERROR:") >= 0) {
        Serial.print(F("[DIAL FAIL] "));
        Serial.println(response);
        return false;
      }
    }
    delay(2);
  }

  Serial.print(F("[DIAL TIMEOUT] "));
  Serial.println(response);
  return false;
}

bool startRxAndPpp() {
  pppRxTaskRun = true;
  BaseType_t created = xTaskCreatePinnedToCore(
    pppRxTask,
    "air780_ppp_rx_diag",
    6144,
    nullptr,
    3,
    &pppRxTaskHandle,
    0
  );
  if (created != pdPASS) {
    pppRxTaskRun = false;
    Serial.println(F("[FAIL] Could not start PPP RX task."));
    return false;
  }

  delay(20);

  LOCK_TCPIP_CORE();
  err_t err = ppp_connect(pppPcb, 0);
  UNLOCK_TCPIP_CORE();

  if (err != ERR_OK) {
    Serial.print(F("[FAIL] ppp_connect returned "));
    Serial.println(static_cast<int>(err));
    return false;
  }

  Serial.println(F("[PPP] Negotiation started. Waiting up to 120 seconds."));
  return true;
}

void printNegotiationSnapshot() {
  if (!pppPcb) return;

  LOCK_TCPIP_CORE();
  Serial.print(F("[SNAPSHOT] phase="));
  Serial.print(phaseName(pppPhase));
  Serial.print(F(" lcp_state="));
  Serial.print(pppPcb->lcp_fsm.state);
#if PPP_IPV4_SUPPORT
  Serial.print(F(" ipcp_state="));
  Serial.print(pppPcb->ipcp_fsm.state);
  Serial.print(F(" ouraddr=0x"));
  Serial.print(pppPcb->ipcp_gotoptions.ouraddr, HEX);
  Serial.print(F(" hisaddr=0x"));
  Serial.print(pppPcb->ipcp_gotoptions.hisaddr, HEX);
  Serial.print(F(" accept_local="));
  Serial.print(pppPcb->ipcp_wantoptions.accept_local);
  Serial.print(F(" accept_remote="));
  Serial.print(pppPcb->ipcp_wantoptions.accept_remote);
#endif
  Serial.println();
  UNLOCK_TCPIP_CORE();
}

void testInternet() {
  if (!pppOnline) return;

  Serial.println();
  Serial.println(F("=== INTERNET TESTS ==="));

  LOCK_TCPIP_CORE();
  ppp_set_default(pppPcb);
  UNLOCK_TCPIP_CORE();

  addrinfo hints = {};
  hints.ai_family = AF_INET;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo* result = nullptr;

  Serial.print(F("[DNS] Resolving "));
  Serial.println(TEST_HOST);
  int gai = getaddrinfo(TEST_HOST, nullptr, &hints, &result);
  if (gai != 0 || !result) {
    Serial.print(F("[DNS FAIL] getaddrinfo="));
    Serial.println(gai);
    return;
  }

  char resolved[INET_ADDRSTRLEN] = {0};
  sockaddr_in* addr = reinterpret_cast<sockaddr_in*>(result->ai_addr);
  inet_ntop(AF_INET, &addr->sin_addr, resolved, sizeof(resolved));
  Serial.print(F("[DNS PASS] "));
  Serial.println(resolved);
  freeaddrinfo(result);

  NetworkClient tcp;
  Serial.print(F("[TCP] "));
  Serial.print(TEST_HOST);
  Serial.print(':');
  Serial.println(TEST_PORT);
  if (!tcp.connect(TEST_HOST, TEST_PORT)) {
    Serial.println(F("[TCP FAIL] Could not open port 443."));
    return;
  }
  Serial.println(F("[TCP PASS] Port 443 connected."));
  tcp.stop();

  NetworkClientSecure tls;
  tls.setInsecure();
  tls.setTimeout(15000);
  Serial.println(F("[TLS] Starting ESP32 TLS handshake to Supabase."));
  if (!tls.connect(TEST_HOST, TEST_PORT)) {
    Serial.println(F("[TLS FAIL] ESP32 TLS handshake failed."));
    return;
  }

  Serial.println(F("[TLS PASS] ESP32 TLS handshake succeeded."));
  tls.print(F("HEAD / HTTP/1.1\r\nHost: "));
  tls.print(TEST_HOST);
  tls.print(F("\r\nConnection: close\r\n\r\n"));

  uint32_t waitStart = millis();
  while (!tls.available() && millis() - waitStart < 7000UL) delay(10);
  if (tls.available()) {
    String statusLine = tls.readStringUntil('\n');
    statusLine.trim();
    Serial.print(F("[HTTPS RESPONSE] "));
    Serial.println(statusLine);
  } else {
    Serial.println(F("[HTTPS] TLS succeeded; no HTTP status line received within 7 seconds."));
  }
  tls.stop();
}

void closePppCleanly() {
  if (!pppPcb) return;

  Serial.println(F("[PPP] Closing diagnostic session."));
  LOCK_TCPIP_CORE();
  ppp_close(pppPcb, 1);
  UNLOCK_TCPIP_CORE();

  uint32_t started = millis();
  while (pppPhase != PPP_PHASE_DEAD && millis() - started < 5000UL) delay(20);

  pppRxTaskRun = false;
  uint32_t rxWait = millis();
  while (pppRxTaskHandle != nullptr && millis() - rxWait < 1500UL) delay(10);

  Serial.print(F("[PPP] Closed at phase="));
  Serial.println(phaseName(pppPhase));
}

void runDiagnostic() {
  Serial.println();
  Serial.println(F("======================================================"));
  Serial.println(F("Dallmayr Air780EU Cellular Diagnostic V6.8.30"));
  Serial.println(F("ONE ATTEMPT ONLY - NO AUTOMATIC RETRY LOOP"));
  Serial.println(F("======================================================"));

  if (!probeAt(3, 2500)) {
    Serial.println(F("[INFO] AT wake burst failed; attempting PPP/data-mode recovery."));
    if (!recoverCommandMode()) {
      Serial.println(F("[STOP] Modem did not return to AT command mode."));
      return;
    }
  }

  // Keep the modem awake for this diagnostic so AT/PPP timing is deterministic.
  atOk("AT+CSCLK=0", 3000);
  atOk("ATE0", 2000);
  atOk("AT+CMEE=2", 2000);

  Serial.println();
  Serial.println(F("=== MODEM / NETWORK BASELINE ==="));
  atQuery("ATI");
  atQuery("AT+CGMM");
  atQuery("AT+CGMR");
  atQuery("AT+CPIN?");
  atQuery("AT+CGATT?");
  atQuery("AT+CEREG?");
  atQuery("AT+CGREG?");
  atQuery("AT+CSQ");
  atQuery("AT+COPS?");

  Serial.println();
  Serial.println(F("=== PDP / APN BASELINE (NO SAPBR, NO HTTP) ==="));
  atQuery("AT+CGDCONT?");
  atQuery("AT+CGAUTH?");
  atQuery("AT+CGACT?");
  atQuery("AT+CGPADDR=1");
  atQuery("AT*GETIP=1");

  // Only rewrite APN if it is not already present. Do not force CGACT down:
  // OpenLuat's reference PPP recipe simply dials the modem's PPP interface.
  String contexts = atQuery("AT+CGDCONT?");
  if (contexts.indexOf("\"internet\"") < 0) {
    Serial.println(F("[APN] 'internet' not present in CID definitions; setting CID1."));
    if (!atOk("AT+CGDCONT=1,\"IP\",\"internet\"", 4000)) {
      Serial.println(F("[STOP] Could not configure CID1 APN."));
      return;
    }
  } else {
    Serial.println(F("[APN] internet already configured; leaving current PDP state untouched."));
  }

  Serial.println();
  Serial.println(F("=== PPP SETUP ==="));
  if (!createPpp()) return;

  if (!dialPpp()) {
    Serial.println(F("[STOP] Modem did not enter PPP data mode."));
    return;
  }

  if (!startRxAndPpp()) {
    Serial.println(F("[STOP] lwIP PPP could not start."));
    recoverCommandMode();
    return;
  }

  uint32_t start = millis();
  uint32_t lastSnapshot = 0;
  while (!pppOnline && millis() - start < PPP_NEGOTIATION_TIMEOUT_MS) {
    if (millis() - lastSnapshot >= 10000UL) {
      lastSnapshot = millis();
      printNegotiationSnapshot();
    }
    delay(50);
  }

  Serial.println();
  Serial.println(F("=== PPP RESULT ==="));
  Serial.print(F("phase="));
  Serial.println(phaseName(pppPhase));
  Serial.print(F("last_error="));
  Serial.print(pppLastError);
  Serial.print(' ');
  Serial.println(pppErrorName(pppLastError));
  Serial.print(F("uart_tx="));
  Serial.println(static_cast<unsigned long long>(pppTxBytes));
  Serial.print(F("uart_rx="));
  Serial.println(static_cast<unsigned long long>(pppRxBytes));

  if (pppOnline) {
    Serial.print(F("[PASS] PPP reached RUNNING. Local IP="));
    Serial.println(pppIp);
    testInternet();
  } else {
    Serial.println(F("[FAIL] PPP did not reach RUNNING within 120 seconds."));
    Serial.println(F("[NEXT] Use the IPCP TX/RX traces above to identify the rejected/NAKed option."));
  }

  closePppCleanly();

  Serial.println();
  Serial.println(F("=== DIAGNOSTIC COMPLETE ==="));
  Serial.println(F("No retry will occur. Power-cycle or reset ESP32 to run again."));
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  CellSerial.begin(CELL_BAUD, SERIAL_8N1, CELL_RX_PIN, CELL_TX_PIN);
  delay(800);
  runDiagnostic();
}

void loop() {
  // Intentionally idle. A single clean attempt is more diagnostically useful
  // than an automatic reconnect loop that contaminates modem/PPP state.
  delay(1000);
}
