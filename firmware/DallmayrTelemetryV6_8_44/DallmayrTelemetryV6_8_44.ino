/*
  Dallmayr South Africa - Telemetry V6.8.44 DB-POLICY NATIVE MDB + DEX
  Production-oriented cellular/Wi-Fi telemetry build

  PRIMARY TARGET
  --------------
  - ESP32-S3 WROOM-1 N16R8 development board
  - DFRobot Gravity Air780E / Air780EU 4G Cat-1 module (UART + external 5 V supply)
  - SP3232EET RS-232 transceiver for DEX/UCS
  - Galvanically isolated MDB electrical interface between the vending machine
    and GPIO4/GPIO5. The ESP32-S3 performs MDB 9-bit framing/decoding itself.
  - Wide-input protected DC/DC supply: vending-machine rail -> regulated 5 V

  MDB PRODUCTION ARCHITECTURE
  ---------------------------
  - GPIO4: passive monitor of MDB Master Transmit (confirmed GREEN / MDB pin 5)
  - GPIO5: passive monitor of MDB Master Receive  (confirmed YELLOW / MDB pin 4)
  - WHITE / MDB pin 6: communications common on the MACHINE SIDE of the isolated
    interface; never connect it directly to an ESP32 GPIO.
  - Both ESP32 MDB pins stay INPUT-ONLY in normal production operation.
  - ESP32 RMT captures the waveform and software reconstructs:
      start + 8 data + mode bit + stop
  - Address/mode semantics and MDB checksums are validated before data is used.
  - A 9-bit encoder and block builder are included for diagnostics/future active
    interfaces, but ACTIVE MDB TRANSMISSION IS COMPILE-TIME DISABLED by default.
  - No external Nano/9-bit decoder is required.

  BACKEND
  -------
  - Supabase telemetry-config: remote live/daily/monthly policy control
  - Supabase telemetry-ingest: cumulative counter, heartbeat and fault-state ingest
  - Successful completed vends are maintained as per-selection cup counters.
  - Failed/cancelled vends never increment successful cup totals.
  - Live mode queues changed cup counters immediately; daily/monthly modes retain
    cumulative counters locally and upload on the DB-selected reporting schedule.
  - DEX ID1 machine identity is captured automatically when exposed by the VMC.
  - MDB-only machines expose a passive protocol/profile fingerprint; standard MDB
    does not guarantee a unique VMC serial, so firmware never invents one.
  - Per-transport application and Air780E modem byte counters are included.
  - Production build does NOT auto-generate dummy sales/simulation telemetry.
  - No database row is created for every vend; cumulative counters are uploaded.

  SAFETY
  ------
  NEVER connect the vending-machine power rail, raw MDB bus, DEX/RS-232 levels,
  or any 24-45 V machine signal directly to ESP32 GPIO. GPIO4/GPIO5 must only
  see protected 3.3 V logic from the isolated MDB electrical interface.

  REQUIRED ARDUINO ENVIRONMENT
  ----------------------------
  - ArduinoJson 7.x
  - Current Arduino-ESP32 3.x (RMT + lwIP PPPoS enabled)
  - Preferences/WiFi/Network/HTTPClient are supplied by the ESP32 Arduino core.
  - Cellular manual PPP uses raw lwIP PPPoS; the generic esp-modem DCE is intentionally bypassed.
*/

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Network.h>
#include <NetworkClientSecure.h>
#include <PPP.h>
#include <HTTPClient.h>
extern "C" {
#include "lwip/opt.h"
#include "lwip/netif.h"
#include "lwip/ip4_addr.h"
#include "lwip/dns.h"
#include "lwip/tcpip.h"
#include "netif/ppp/ppp.h"
#include "netif/ppp/pppos.h"
}
#include <esp_mac.h>
#include <math.h>
#include <stdlib.h>
#include "esp32-hal-rmt.h"
#include <esp_arduino_version.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

#if ESP_ARDUINO_VERSION_MAJOR < 3
#error "Dallmayr V6.8 native MDB requires Arduino-ESP32 core 3.x or newer."
#endif

// -----------------------------------------------------------------------------
// Serial mirror for Remote Test Center
// -----------------------------------------------------------------------------
// Keep one physical Serial console and mirror its exact printable output into a
// bounded RAM ring. No remote data is transmitted unless an authenticated,
// auto-expiring Test Center session is active.
void remoteDebugCaptureByte(uint8_t value);
void printStatus();
void printMachineIdentity();
void printCupCounters();
void handleConsoleLine(String line);
void applyConfiguredMdbPolarity(bool announce, bool force = false);

auto& DallmayrNativeSerial = Serial;

class DallmayrSerialProxy : public Print {
 public:
  void begin(uint32_t baud) { DallmayrNativeSerial.begin(baud); }
  int available() { return DallmayrNativeSerial.available(); }
  int read() { return DallmayrNativeSerial.read(); }
  void flush() { DallmayrNativeSerial.flush(); }

  size_t write(uint8_t value) override {
    size_t written = DallmayrNativeSerial.write(value);
    remoteDebugCaptureByte(value);
    return written;
  }

  using Print::write;
};

DallmayrSerialProxy DallmayrDebugSerial;
#define Serial DallmayrDebugSerial

// -----------------------------------------------------------------------------
// Native MDB types
// -----------------------------------------------------------------------------
// These declarations intentionally live before the first sketch function.
// Arduino generates function prototypes during .ino preprocessing; keeping
// custom MDB types here ensures those generated prototypes can see the types.

struct MdbWord {
  uint8_t value;
  bool mode;
  bool framingValid;
};

struct MdbCashlessState {
  uint8_t scaleFactor = 1;
  uint8_t decimalPlaces = 2;
  bool scaleKnown = false;
  uint8_t featureLevel = 1;
  uint32_t supportedFeatureBits = 0;

  // Passive MDB identity evidence. These fields describe the cashless
  // peripheral(s) observed on the bus, not a guaranteed VMC serial number.
  char manufacturer[4] = {0};
  char peripheralSerial[13] = {0};
  char modelNumber[13] = {0};
  char softwareVersion[3] = {0};
  bool peripheralIdKnown = false;

  // MDB Level 3 Expansion Options. When either the 32-bit monetary-format bit
  // or the multi-currency bit is enabled, monetary fields use the expanded
  // 32-bit representation. This is learned from the VMC's checksum-valid
  // EXPANSION / ENABLE OPTIONS command instead of guessing from packet length.
  uint32_t enabledFeatureBits = 0;
  bool expandedCurrency = false;

  bool vendPending = false;
  bool vendApproved = false;
  uint16_t selection = 0xFFFF;
  uint32_t requestedScaledPrice = 0;
  uint32_t approvedScaledPrice = 0;
  uint32_t vendStartedMs = 0;

  uint8_t activeErrorCode = 0;
  bool errorActive = false;
  bool outOfSequenceActive = false;
};

struct MdbLastMasterContext {
  uint8_t address = 0;
  uint8_t command = 0;
  uint8_t subcommand = 0xFF;
  uint32_t atMs = 0;
};

struct MdbVendDedup {
  uint16_t selection = 0xFFFF;
  uint32_t priceCents = 0;
  bool success = false;
  uint32_t atMs = 0;
};

enum MdbTelemetryEventType : uint8_t {
  MDB_EVENT_VEND = 1,
  MDB_EVENT_CASHLESS_ERROR_SET = 2,
  MDB_EVENT_CASHLESS_ERROR_CLEAR = 3,
  MDB_EVENT_OUT_OF_SEQUENCE_SET = 4,
  MDB_EVENT_OUT_OF_SEQUENCE_CLEAR = 5
};

enum MdbVendReason : uint8_t {
  MDB_VEND_CASHLESS_SUCCESS = 1,
  MDB_VEND_CASHLESS_FAILURE = 2,
  MDB_VEND_CASH_SALE = 3,
  MDB_VEND_RESET_AFTER_APPROVAL = 4,
  MDB_VEND_BASKET_SUCCESS = 5,
  MDB_VEND_BASKET_FAILURE = 6,
  MDB_VEND_FREE_VEND = 7
};

struct MdbTelemetryEvent {
  MdbTelemetryEventType type;
  uint8_t readerIndex;
  uint8_t code;
  uint8_t status;
  uint8_t reason;
  uint16_t selection;
  uint32_t priceCents;
  bool success;
};

struct MdbRawDebugFrame {
  bool masterDirection;
  uint8_t count;
  uint8_t values[24];
  uint32_t modeMask;
  uint32_t atMs;
  uint16_t repeatCount;
  bool diagnosticSample;

  uint8_t normalCount;
  uint8_t normalValues[12];
  uint16_t normalModeMask;
  int16_t normalScore;

  uint8_t invertedCount;
  uint8_t invertedValues[12];
  uint16_t invertedModeMask;
  int16_t invertedScore;

  uint8_t pulseCount;
  uint8_t pulseLevels[16];
  uint16_t pulseDurationsUs[16];
};

// -----------------------------------------------------------------------------
// Explicit MDB prototypes - Arduino .ino preprocessor workaround
// -----------------------------------------------------------------------------
// Arduino generates prototypes automatically for functions in .ino sketches.
// Its prototype generator can place a generated prototype before a custom type
// declaration, which causes errors such as "MdbWord has not been declared".
// Declaring these prototypes ourselves after the MDB types prevents that.

size_t mdbEncodeMasterBlock(uint8_t address,
                            const uint8_t* data,
                            size_t dataLength,
                            MdbWord* out,
                            size_t outCapacity);
bool mdbQueueTelemetryEvent(const MdbTelemetryEvent& event);
uint32_t mdbReadBigEndian(const MdbWord* words, size_t offset, size_t bytes);
size_t mdbDecodeRmtWords(const rmt_data_t* symbols,
                         size_t symbolCount,
                         bool invert,
                         MdbWord* outWords,
                         size_t outCapacity,
                         uint32_t& framingErrors);
bool mdbMasterSegmentChecksumValid(const MdbWord* words,
                                   size_t start,
                                   size_t endInclusive,
                                   size_t& checksumIndex);
int mdbScoreMasterWords(const MdbWord* words, size_t count);
int mdbScoreSlaveWords(const MdbWord* words, size_t count);
size_t mdbDecodeWithPolarity(const rmt_data_t* symbols,
                             size_t symbolCount,
                             bool masterDirection,
                             int8_t& learnedInvert,
                             MdbWord* outWords,
                             size_t outCapacity);
void mdbHandleMasterBlock(const MdbWord* block, size_t count);
size_t mdbCashlessMessageLength(const MdbCashlessState& cashless,
                                const MdbWord* data,
                                size_t remaining);
void mdbHandleSlaveMessage(int cashlessIdx, const MdbWord* data, size_t dataCount);
void mdbHandleSlaveData(int cashlessIdx, const MdbWord* data, size_t dataCount);
void mdbProcessMasterWords(const MdbWord* words, size_t count);
void mdbProcessSlaveWords(const MdbWord* words, size_t count);
void mdbProcessCapture(const rmt_data_t* symbols,
                       size_t symbolCount,
                       bool masterDirection,
                       int8_t& learnedInvert);



// -----------------------------------------------------------------------------
// Firmware identity / backend preset
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// PRODUCTION SETTINGS
// -----------------------------------------------------------------------------
// This build embeds the Supabase public anon JWT. An enrolled unit loads its
// private per-device credential from ESP32 NVS, so uploading a new sketch must
// be done WITHOUT "Erase All Flash". A brand-new unit automatically retries
// zero-touch enrollment until an Administrator opens an enrollment window in
// DallmayrERP. A single-use token remains available as an emergency fallback.
// Configure Wi-Fi at runtime with:
//   WIFI SET <ssid>|<password>
// The credentials are stored in ESP32 NVS and are never printed back.
//
// If this ESP32 is already enrolled, its per-device credential remains in NVS.
// For another new unit or after erasing NVS, provision a fresh one-time token with:
//   ENROLL TOKEN <one-time-token>
// The token is erased from NVS immediately after successful enrollment.
//
#define DALLMAYR_WIFI_SSID              ""
#define DALLMAYR_WIFI_PASSWORD          ""
#define DALLMAYR_CELL_APN               "internet"
#define DALLMAYR_MACHINE_SERIAL         ""
#define DALLMAYR_ENROLLMENT_TOKEN       ""
// Supabase anon JWT is a public client credential used by the Edge Function
// gateway. Keep it on ONE source line so Arduino cannot split the C++ literal.
#define DALLMAYR_SUPABASE_ANON_KEY      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnYmlpaXp4c3FsYXJxcG56eHhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMDk0MzksImV4cCI6MjA5OTU4NTQzOX0.uOvKQzrbw_48QX_WT9qeIFsnigC1aiifvsoCtuL32YQ"
//
// Simulation telemetry is available for this controlled commissioning build.
// It remains isolated from production sales and only runs from the console
// unless the explicit auto-run flag below is enabled.
#define DALLMAYR_SIM_DATA_TEST_ENABLED  true
// Keep automatic execution off: run SIM DATA TEST manually after cellular
// registration so the technician controls when dummy traffic is sent.
#define DALLMAYR_SIM_DATA_TEST_AUTO_RUN false
// Prefer the SIM for first-boot enrollment so the cellular path is proven.
// Wi-Fi remains available as a fallback and for normal remote operation.
#define DALLMAYR_ZERO_TOUCH_CELL_FIRST  true
//
// Machine-interface support is compiled in. Native MDB is the production
// default and is PASSIVE: GPIO4/GPIO5 are both RMT inputs.
//   INTERFACE MDB          (native passive 9-bit decoder on GPIO4/GPIO5)
//   INTERFACE DEX          (SP3232 on GPIO17/GPIO18)
//   INTERFACE DISABLED     (all machine capture off)
// Legacy MDB_BRIDGE NVS settings are migrated automatically to native MDB.
#define DALLMAYR_MACHINE_IO_ENABLED     true
// Prevent console-generated fake faults/recoveries in production.
#define DALLMAYR_ALLOW_TEST_COMMANDS    false
#define DALLMAYR_MDB_ACTIVE_TX_ENABLED  false   // must remain false for passive production telemetry
#define DALLMAYR_MDB_AUTO_POLARITY      true    // learns electrical-interface inversion from valid frames
#define DALLMAYR_DEFAULT_INTERFACE      2       // IFACE_MDB; passive native decoder

#if DALLMAYR_MDB_ACTIVE_TX_ENABLED
#error "Active MDB bus driving is intentionally not supported by this passive telemetry build."
#endif
//
// Generic NMEA GNSS receiver. Keep this OFF unless a physical GNSS module is
// fitted. UART0 is normally the ESP32-S3 programming/debug console and must
// never be reassigned while it is being used by Serial Monitor.
#define DALLMAYR_GNSS_ENABLED           0
#define DALLMAYR_GNSS_BAUD              9600UL
#define DALLMAYR_GNSS_RX_PIN            6   // ESP32 RX <- GNSS TX
#define DALLMAYR_GNSS_TX_PIN            7   // ESP32 TX -> GNSS RX (often optional)
// 0/0 disables manual location fallback; production never invents a GPS fix.
#define DALLMAYR_FALLBACK_LATITUDE      0.0
#define DALLMAYR_FALLBACK_LONGITUDE     0.0
// -----------------------------------------------------------------------------
// END PRODUCTION SETTINGS
// -----------------------------------------------------------------------------
// ----------------------------------------------------------------------------- -----------------------------------------------------------------------------

static const char* FIRMWARE_VERSION = "6.8.44-esp32s3-air780eu-mdb-rmt-idle-tail";
static const char* API_HOST = "egbiiizxsqlarqpnzxxs.supabase.co";
static const char* ENROLL_URL = "https://egbiiizxsqlarqpnzxxs.supabase.co/functions/v1/telemetry-enroll";
static const char* INGEST_URL = "https://egbiiizxsqlarqpnzxxs.supabase.co/functions/v1/telemetry-ingest";
static const char* CONFIG_URL = "https://egbiiizxsqlarqpnzxxs.supabase.co/functions/v1/telemetry-config";
// This SIM returns its detailed prepaid data balance through *111*502#.
// V6.8.16 used *135*500#, which did not return a balance on the deployed SIM.
static const char* DEFAULT_PREPAID_BALANCE_USSD = "*111*502#";
static const char* RETIRED_PREPAID_BALANCE_USSD = "*135*500#";
// AT+HTTPPARA="TIMEOUT" controls the complete modem-side HTTP operation.
// Keep the MCU wait longer than the modem deadline. V6.8.44 deliberately uses
// the standard HTTPDATA/HTTPACTION/HTTPREAD path because the deployed V1180
// Air780EU accepts HTTPEXACTION but never opens the HTTPEXPOST data prompt.
static const uint16_t AIR780_HTTP_TIMEOUT_SECONDS = 45;
static const uint32_t AIR780_HTTP_ACTION_WAIT_MS =
  (static_cast<uint32_t>(AIR780_HTTP_TIMEOUT_SECONDS) + 10UL) * 1000UL;
static const uint32_t AIR780_HTTP_POST_CHUNK_TIMEOUT_MS = 15000UL;

// Device identity is derived automatically from the ESP32 factory eFuse MAC.
// The database UUID remains server-generated; the public device code becomes:
// DLM-ESP32-XXXXXXXXXXXX
String hardwareUid;
String deviceId;
String deviceKey;
String enrollmentToken;
String supabaseAnonKey = DALLMAYR_SUPABASE_ANON_KEY;

// In production mode this is supplied from the USER SETTINGS section above. Later the MDB/DEX driver can
// replace it with a machine-reported serial when the machine exposes one.
String reportedMachineSerial = DALLMAYR_MACHINE_SERIAL;
String reportedMachineModel;
String reportedMachineRevision;
String reportedMachineLocation;
String reportedMachineAsset;
String machineIdentitySource;
String machineProfileFingerprint;

// Production Wi-Fi credentials are loaded from ESP32 NVS. Compile-time values are blank fallbacks.
String wifiSsid = DALLMAYR_WIFI_SSID;
String wifiPassword = DALLMAYR_WIFI_PASSWORD;

// Public-network SIMs normally obtain APN automatically.
static const char* DEFAULT_APN = DALLMAYR_CELL_APN;

// -----------------------------------------------------------------------------
// ESP32 pin assignment
// -----------------------------------------------------------------------------
// ESP32-S3 has three UARTs. Serial/USB is used for diagnostics, UART1 for the
// Air780E/Air780EU and UART2 for DEX through the SP3232EET.
// Pins can be changed here if the quoted development board breaks them out on
// different headers.

/*
  CONFIRMED MDB 6-PIN CABLE MAP — MALE CONNECTOR FACE VIEW
  --------------------------------------------------------
  User-confirmed occupied-wire positions:
    MDB pin 4 = YELLOW = Master Receive
    MDB pin 5 = GREEN  = Master Transmit
    MDB pin 6 = WHITE  = Communications Common
    MDB pin 3 = empty / N.C.

  Production telemetry connection:
    GREEN / pin 5  -> MACHINE SIDE isolated MDB receiver -> 3.3 V logic -> GPIO4
    YELLOW / pin 4 -> MACHINE SIDE isolated MDB receiver -> 3.3 V logic -> GPIO5
    WHITE / pin 6  -> MACHINE SIDE communications reference for the isolated interface

  IMPORTANT:
  GPIO4 and GPIO5 are BOTH passive INPUTS in native MDB mode. The labels RX/TX
  describe MDB bus direction relative to the VMC, not ESP32 UART direction.
  Do not connect GREEN, YELLOW or WHITE directly to the ESP32.

  DEX wiring remains through the SP3232EET and must be verified independently.
  Cellular wiring is independent of the machine cable:
    Air780E/Air780EU TX -> ESP32 CELL_RX_PIN
    Air780E/Air780EU RX <- ESP32 CELL_TX_PIN
*/

#if CONFIG_IDF_TARGET_ESP32S3
// ---------------- ESP32-S3 WROOM-1 N16R8 prototype pin assignment ----------------
static const int CELL_RX_PIN = 1;   // GPIO1 <- Air780 TX (confirmed prototype wiring)
static const int CELL_TX_PIN = 2;   // GPIO2 -> Air780 RX (confirmed prototype wiring)

static const int DEX_RX_PIN  = 17;  // GPIO17 <- SP3232 R1OUT <- C130001 ORANGE (DEX TX from machine)
static const int DEX_TX_PIN  = 18;  // GPIO18 -> SP3232 T1IN  -> C130001 BROWN  (DEX RX to machine)

static const int MDB_VMC_TX_MONITOR_PIN = 4; // GPIO4 <- isolated logic copy of GREEN, MDB pin 5 / Master Transmit
static const int MDB_VMC_RX_MONITOR_PIN = 5; // GPIO5 <- isolated logic copy of YELLOW, MDB pin 4 / Master Receive
// Backward-compatible aliases used by a few status/wiring helpers.
static const int MDB_RX_PIN = MDB_VMC_TX_MONITOR_PIN;
static const int MDB_TX_PIN = MDB_VMC_RX_MONITOR_PIN;
#elif CONFIG_IDF_TARGET_ESP32
// Classic ESP32-WROOM compatibility for bench development.
// Same C130001 signal paths as above; only the ESP32 GPIO numbers differ.
static const int CELL_RX_PIN = 26;  // GPIO26 <- Air780E/Air780EU TX
static const int CELL_TX_PIN = 27;  // GPIO27 -> Air780E/Air780EU RX
static const int DEX_RX_PIN  = 32;  // GPIO32 <- SP3232 R1OUT <- C130001 ORANGE
static const int DEX_TX_PIN  = 33;  // GPIO33 -> SP3232 T1IN  -> C130001 BROWN
static const int MDB_VMC_TX_MONITOR_PIN = 34; // isolated logic copy of MDB Master Transmit
static const int MDB_VMC_RX_MONITOR_PIN = 25; // isolated logic copy of MDB Master Receive
static const int MDB_RX_PIN = MDB_VMC_TX_MONITOR_PIN;
static const int MDB_TX_PIN = MDB_VMC_RX_MONITOR_PIN;
#else
#error "This quoted-hardware sketch targets ESP32-S3 or classic ESP32."
#endif

static const uint32_t DEBUG_BAUD = 115200;
static const uint32_t CELL_BAUD  = 115200;
static const uint32_t DEFAULT_DEX_BAUD = 9600;
static const uint32_t DEFAULT_MDB_BRIDGE_BAUD = 115200; // legacy only; retained for NVS compatibility
static const uint32_t MDB_BAUD = 9600;
static const uint32_t MDB_RMT_HZ = 1000000UL;       // 1 us RMT tick
static const uint32_t MDB_BIT_US = 104;              // 1 / 9600 ≈ 104.17 us
static const uint16_t MDB_RX_IDLE_US = 2500;         // > 1 ms max inter-byte; < 5 ms response window
// Arduino-ESP32 expresses the RX filter in RMT ticks. On ESP32-S3 the shared
// 80 MHz RMT group clock limits this filter to about 3.187 us even when the
// channel itself runs at 1 MHz. Three ticks therefore retain a hardware glitch
// filter without triggering IDF's signal_range_min_ns validation failure.
static const uint8_t MDB_NOISE_FILTER_TICKS = 3;
static const uint32_t MDB_SIGNAL_LOSS_MS = 60000UL;
static const uint32_t MDB_RESPONSE_CONTEXT_MAX_MS = 25UL;
static const uint32_t MDB_DUPLICATE_VEND_WINDOW_MS = 2500UL;

HardwareSerial CellSerial(1);
HardwareSerial DexSerial(2);
#if DALLMAYR_GNSS_ENABLED
HardwareSerial GnssSerial0(0);
#endif
HardwareSerial* gnssSerial = nullptr;
Preferences prefs;

struct GnssFix {
  bool valid = false;
  double latitude = 0.0;
  double longitude = 0.0;
  float altitudeM = NAN;
  float speedMps = NAN;
  uint8_t satellites = 0;
  float hdop = NAN;
  float accuracyM = NAN;
  uint32_t lastFixMs = 0;
  char utcIso[25] = {0};
};

GnssFix gnssFix;
String gnssLine;
uint32_t lastLocationUploadMs = 0;

// -----------------------------------------------------------------------------
// Limits / scheduling
// -----------------------------------------------------------------------------

static const uint16_t MAX_COUNTERS = 96;
// Backend accepts up to 16, but Air780EU standard HTTPDATA is limited to
// roughly 3.3 KB. Ten items leaves headroom for machine identity, transport,
// data-usage and cup-counter metadata without fragmenting a JSON document.
static const uint8_t MAX_ITEMS_PER_UPLOAD = 10;
static const uint8_t MAX_FAULTS = 24;
static const size_t DEX_TEXT_MAX = 12288;
static const uint32_t CONFIG_RETRY_MS = 60000UL;
static const uint32_t CELL_RETRY_MS = 10000UL;
static const uint32_t PPP_CONNECT_TIMEOUT_MS = 120000UL;
static const char* VODACOM_PPP_PASSWORD = "";
static const char* VODACOM_PPP_USERNAME_BLANK = "";
static const char* VODACOM_PPP_USERNAME_GUEST = "guest";
static const uint32_t DEX_REQUEST_TIMEOUT_MS = 15000UL;
static const uint32_t DEX_FRAME_IDLE_MS = 1800UL;
static const uint32_t COUNTER_SAVE_DEBOUNCE_MS = 5000UL;
static const uint32_t DATA_USAGE_SAVE_INTERVAL_MS = 300000UL;
static const uint32_t SERIAL_ALIVE_INTERVAL_MS = 5000UL;
// Network upload failures must never become a tight retry loop. A rejected
// MDB-derived record previously monopolised the Air780EU and starved config/heartbeat.
static const uint32_t FAULT_UPLOAD_RETRY_MS = 30000UL;
static const uint32_t COUNTER_UPLOAD_RETRY_MS = 30000UL;
static const uint32_t HEARTBEAT_UPLOAD_RETRY_MS = 30000UL;
static const uint32_t CONFIG_ACK_RETRY_MS = 30000UL;
static const uint32_t TRANSPORT_COMMIT_RETRY_MS = 15000UL;
static const uint32_t VODACOM_USSD_TIMEOUT_MS = 45000UL;
static const uint32_t PREPAID_BALANCE_FAILED_RETRY_MS = 30UL * 60000UL;

// -----------------------------------------------------------------------------
// Runtime configuration / state
// -----------------------------------------------------------------------------

enum MachineInterface : uint8_t {
  IFACE_DEX = 1,
  IFACE_MDB = 2,
  IFACE_NORMALIZED_UART = 3,
  IFACE_PULSE = 4,
  IFACE_DISABLED = 5,
  IFACE_MDB_BRIDGE = 6
};

struct RuntimePolicy {
  char mode[12];
  char source[16];
  char policyCode[24];
  char policyUpdatedAt[40];
  char profileId[48];
  uint32_t counterIntervalMinutes;
  uint32_t heartbeatIntervalMinutes;
  uint32_t configRefreshMinutes;
  bool immediateFaults;
  bool immediateRecovery;
  bool counterDue;
  bool heartbeatDue;
  char transportPreference[12];
  bool wifiEnabled;
  bool cellularEnabled;
  char mdbMasterPolarity[12];
  char mdbSlavePolarity[12];
  bool prepaidBalanceEnabled;
  bool prepaidBalanceDue;
  uint32_t prepaidBalanceCheckIntervalMinutes;
  uint32_t prepaidBalanceStaleAfterMinutes;
  char prepaidBalanceUssdCode[24];
  bool locationEnabled;
  uint32_t locationIntervalMinutes;
  uint32_t locationMinMoveM;
  bool locationDue;
};

struct CounterEntry {
  char selection[41];
  char product[65];
  uint32_t priceCents;
  uint64_t soldTotal;
  uint64_t failedTotal;
  uint64_t revenueCentsTotal;
  bool used;
  bool dirty;
};

struct LocalFault {
  char code[41];
  char severity[12];
  bool active;
  bool used;
  bool pendingUpload;
};

RuntimePolicy policy;
CounterEntry counters[MAX_COUNTERS];
LocalFault faults[MAX_FAULTS];
uint16_t counterCount = 0;

char counterEpoch[33] = {0};
char bootId[33] = {0};
char dataUsageEpoch[33] = {0};
uint32_t sequenceNumber = 0;
uint64_t cellularApplicationTxBytes = 0;
uint64_t cellularApplicationRxBytes = 0;
uint64_t cellularModemTxBytes = 0;
uint64_t cellularModemRxBytes = 0;
bool cellularModemUsageAvailable = false;
uint32_t lastCellularModemUsageSampleMs = 0;
int cellularCsq = -1;
uint64_t wifiApplicationTxBytes = 0;
uint64_t wifiApplicationRxBytes = 0;
bool dataUsageStorageDirty = false;
uint32_t lastDataUsageSaveMs = 0;
uint64_t prepaidBalanceRemainingBytes = 0;
bool prepaidBalanceAvailable = false;
bool prepaidBalanceReportPending = false;
String prepaidBalanceStatus = "unknown";
String prepaidBalanceText;
String prepaidBalanceError;
uint32_t lastPrepaidBalanceCheckMs = 0;
MachineInterface machineInterface = static_cast<MachineInterface>(DALLMAYR_DEFAULT_INTERFACE);
uint32_t dexBaud = DEFAULT_DEX_BAUD;
uint32_t mdbBridgeBaud = DEFAULT_MDB_BRIDGE_BAUD;
String apn = DEFAULT_APN;
String cellularModel;
String cellularFirmware;
String cellularOperator;
uint32_t lastWifiAttemptMs = 0;
uint32_t wifiConnectionStartedMs = 0;
bool wifiBeginIssued = false;   // Prevent repeated WiFi.begin() while STA is still connecting.
bool wifiRadioDisabled = false;
static const uint32_t WIFI_STATUS_LOG_MS = 60000UL;
static const uint32_t WIFI_PRIMARY_GRACE_MS = 20000UL;

uint32_t lastConfigAttemptMs = 0;
uint32_t lastConfigSuccessMs = 0;
uint32_t lastCellAttemptMs = 0;
uint32_t lastCounterSaveMs = 0;
bool counterStorageDirty = false;
bool cellReady = false;              // true only when the PPP cellular IP link is usable
bool cellModemRegistered = false;     // AT-side registration state before PPP handoff
bool pppStarted = false;
volatile bool pppOnline = false;
uint32_t pppStartedAtMs = 0;
static struct netif airPppNetif;
static ppp_pcb* airPppPcb = nullptr;
static TaskHandle_t airPppRxTaskHandle = nullptr;
static volatile bool airPppRxTaskRun = false;
static volatile int airPppLastError = PPPERR_NONE;
static volatile u8_t airPppPhase = PPP_PHASE_DEAD;
static volatile bool airPppControlBlockReady = false;
static volatile uint8_t airPppAuthProfileIndex = 0; // 0=blank/blank, 1=guest/blank
static volatile bool airPppAuthProfileExhausted = false;
static volatile uint64_t airPppUartTxBytes = 0;
static volatile uint64_t airPppUartRxBytes = 0;
static char airPppIpAddress[20] = {0};

struct AirPppTraceState {
  bool inFrame = false;
  bool escaped = false;
  uint8_t frame[512];
  size_t len = 0;
};

static AirPppTraceState airPppTxTrace;
static AirPppTraceState airPppRxTrace;
bool air780TlsConfigured = false;
uint8_t air780TlsConfigurationAttempts = 0;
uint8_t air780HttpRecoveryCount = 0;
bool automaticSimulationTestCompleted = false;
bool counterUploadRequested = false;
bool heartbeatUploadRequested = false;
uint32_t lastEnrollmentAttemptMs = 0;
uint32_t lastSimulationUploadMs = 0;
uint32_t lastSerialAliveMs = 0;
uint32_t lastFaultUploadAttemptMs = 0;
uint32_t lastCounterUploadAttemptMs = 0;
uint32_t lastCounterUploadSuccessMs = 0;
uint32_t counterScheduleStartMs = 0;
uint32_t lastHeartbeatUploadAttemptMs = 0;
uint32_t lastHeartbeatUploadSuccessMs = 0;
uint32_t lastConfigAckAttemptMs = 0;
bool configAckPending = false;
// When a newly downloaded policy disables the connection that carried the
// configuration, keep that physical link alive until the config ACK and one
// heartbeat have both reached Supabase. This prevents the device from cutting
// off the only proven-good transport before the control change is committed.
bool transportTransitionPending = false;
char transportTransitionSource[12] = {0};
uint32_t lastTransportTransitionAttemptMs = 0;
uint8_t simulationSelectionCursor = 0;
uint64_t simulationSold[3] = { 100, 75, 50 };
uint64_t simulationRevenue[3] = { 250000, 187500, 125000 };
uint32_t lastMachineByteMs = 0;
uint32_t acceptedMachineRecords = 0;
uint32_t rejectedMachineRecords = 0;

// Remote Test Center keeps a rolling pre-session Serial history in RAM, then
// uploads it in small batches only while a server-authorized session is active.
static const uint16_t REMOTE_DEBUG_RING_LINES = 160;
static const uint16_t REMOTE_DEBUG_LINE_BYTES = 221;
static const uint8_t REMOTE_DEBUG_UPLOAD_LINES = 8;
static const uint32_t REMOTE_DEBUG_UPLOAD_INTERVAL_MS = 1500UL;
static const uint32_t REMOTE_DEBUG_ACTIVE_CONFIG_POLL_MS = 10000UL;

struct RemoteDebugLine {
  uint64_t sequence;
  uint32_t uptimeMs;
  char message[REMOTE_DEBUG_LINE_BYTES];
};

RemoteDebugLine remoteDebugRing[REMOTE_DEBUG_RING_LINES];
uint16_t remoteDebugHead = 0;
uint16_t remoteDebugCount = 0;
uint64_t remoteDebugSequence = 0;
char remoteDebugCurrentLine[REMOTE_DEBUG_LINE_BYTES] = {0};
uint16_t remoteDebugCurrentLength = 0;
volatile bool remoteDebugCaptureSuppressed = false;
volatile bool remoteDebugActive = false;
volatile bool remoteDebugRawMdb = false;
volatile bool remoteDebugRawDex = false;
bool remoteDebugHttpTrace = true;
bool remoteDebugCupCounters = true;
bool remoteDebugMachineIdentity = true;
char remoteDebugSessionId[40] = {0};
uint32_t remoteDebugExpiresAtMs = 0;
uint32_t remoteDebugLastUploadMs = 0;
uint32_t remoteDebugDroppedLines = 0;
char remoteDebugCompletedCommandIds[8][40] = {{0}};
uint8_t remoteDebugCompletedCommandCount = 0;

static const uint32_t ENROLL_RETRY_MS = 15000UL;
static const uint32_t AUTOMATIC_SIM_TEST_RETRY_MS = 30000UL;

// DEX receiver state.
String dexText;
uint32_t lastDexByteMs = 0;
uint32_t dexRequestStartedMs = 0;
bool dexRequestActive = false;
bool dexSawDataThisRequest = false;
bool dexInBlock = false;
bool dexSawDle = false;
uint8_t dexCrcBytesRemaining = 0;
bool dexAckToggle = true;  // First block ACK is DLE '1', then alternates.
int dexDecimalPlaces = 2;

// Explicit transport forward declarations. Arduino normally auto-generates
// these for .ino files, but explicit declarations keep compilation deterministic
// even when the sketch is copied into another Arduino project.
bool wifiReady();

// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------

void copyText(char* out, size_t outSize, const String& value) {
  if (!out || outSize == 0) return;
  value.substring(0, outSize - 1).toCharArray(out, outSize);
  out[outSize - 1] = '\0';
}

String trimCopy(String value) {
  value.trim();
  return value;
}

void makeRandomId(char* out, size_t outSize) {
  uint64_t r = (static_cast<uint64_t>(esp_random()) << 32) | esp_random();
  snprintf(out, outSize, "%08lX%08lX",
           static_cast<unsigned long>(r >> 32),
           static_cast<unsigned long>(r & 0xFFFFFFFFULL));
}

void initializeDeviceIdentity() {
  uint8_t mac[6] = {0};
  if (esp_efuse_mac_get_default(mac) != ESP_OK) {
    Serial.println(F("FATAL: could not read ESP32 factory MAC/eFuse identity."));
    return;
  }

  char uid[13] = {0};
  snprintf(uid, sizeof(uid), "%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  hardwareUid = uid;
  deviceId = "DLM-ESP32-" + hardwareUid;
}

bool deviceEnrolled() {
  return deviceId.length() > 0 && deviceKey.length() >= 20;
}

void saveDeviceCredential() {
  prefs.begin("dallmayr", false);
  prefs.putString("device_key", deviceKey);
  prefs.end();
}

const char* interfaceName(MachineInterface iface) {
  switch (iface) {
    case IFACE_DEX: return "dex";
    case IFACE_MDB: return "mdb";
    case IFACE_NORMALIZED_UART: return "normalized_uart";
    case IFACE_PULSE: return "pulse";
    case IFACE_DISABLED: return "disabled";
    case IFACE_MDB_BRIDGE: return "mdb_bridge_legacy";
    default: return "unknown";
  }
}

MachineInterface parseInterface(String value) {
  value.trim();
  value.toUpperCase();
  if (value == "DEX") return IFACE_DEX;
  if (value == "MDB") return IFACE_MDB;
  if (value == "NORMALIZED" || value == "NORMALIZED_UART") return IFACE_NORMALIZED_UART;
  if (value == "PULSE") return IFACE_PULSE;
  if (value == "DISABLED") return IFACE_DISABLED;
  if (value == "MDB_BRIDGE" || value == "BRIDGE") return IFACE_MDB_BRIDGE;
  return static_cast<MachineInterface>(0);
}

bool selectableMachineInterface(MachineInterface iface) {
  return iface == IFACE_DEX || iface == IFACE_NORMALIZED_UART ||
         iface == IFACE_MDB || iface == IFACE_DISABLED;
}

uint64_t toUInt64(const String& s) {
  return strtoull(s.c_str(), nullptr, 10);
}

uint64_t dexValueToCents(uint64_t raw) {
  if (dexDecimalPlaces == 2) return raw;
  if (dexDecimalPlaces < 2) {
    for (int i = dexDecimalPlaces; i < 2; ++i) raw *= 10ULL;
    return raw;
  }
  for (int i = 2; i < dexDecimalPlaces; ++i) raw /= 10ULL;
  return raw;
}

String fieldAt(const String& line, int wantedIndex) {
  int fieldIndex = 0;
  int start = 0;
  for (int i = 0; i <= line.length(); ++i) {
    if (i == line.length() || line.charAt(i) == '*') {
      if (fieldIndex == wantedIndex) return line.substring(start, i);
      fieldIndex++;
      start = i + 1;
    }
  }
  return "";
}

uint32_t fnv1a32(const String& value) {
  uint32_t hash = 2166136261UL;
  for (size_t i = 0; i < value.length(); ++i) {
    hash ^= static_cast<uint8_t>(value.charAt(i));
    hash *= 16777619UL;
  }
  return hash;
}

String fingerprintHex(uint32_t value) {
  char out[9] = {0};
  snprintf(out, sizeof(out), "%08lX", static_cast<unsigned long>(value));
  return String(out);
}

// -----------------------------------------------------------------------------
// Persistent storage (ESP32 NVS)
// -----------------------------------------------------------------------------

void saveCoreSettings() {
  prefs.begin("dallmayr", false);
  prefs.putString("apn", apn);
  prefs.putUChar("iface", static_cast<uint8_t>(machineInterface));
  prefs.putULong("dexbaud", dexBaud);
  prefs.putULong("mdbbaud", mdbBridgeBaud);
  prefs.putString("epoch", counterEpoch);
  prefs.putString("machine_sn", reportedMachineSerial);
  prefs.putString("machine_model", reportedMachineModel);
  prefs.putString("machine_rev", reportedMachineRevision);
  prefs.putString("machine_loc", reportedMachineLocation);
  prefs.putString("machine_asset", reportedMachineAsset);
  prefs.putString("machine_idsrc", machineIdentitySource);
  prefs.putString("machine_fp", machineProfileFingerprint);
  prefs.end();
}

void saveDataUsageNow() {
  prefs.begin("dallmayr", false);
  prefs.putString("usage_epoch", dataUsageEpoch);
  prefs.putULong64("cell_app_tx", cellularApplicationTxBytes);
  prefs.putULong64("cell_app_rx", cellularApplicationRxBytes);
  prefs.putULong64("wifi_app_tx", wifiApplicationTxBytes);
  prefs.putULong64("wifi_app_rx", wifiApplicationRxBytes);
  prefs.end();
  dataUsageStorageDirty = false;
  lastDataUsageSaveMs = millis();
}

void recordApplicationTransfer(const char* transport, size_t requestBytes, size_t responseBytes) {
  if (strcmp(transport, "cellular") == 0) {
    cellularApplicationTxBytes += static_cast<uint64_t>(requestBytes);
    cellularApplicationRxBytes += static_cast<uint64_t>(responseBytes);
  } else if (strcmp(transport, "wifi") == 0) {
    wifiApplicationTxBytes += static_cast<uint64_t>(requestBytes);
    wifiApplicationRxBytes += static_cast<uint64_t>(responseBytes);
  } else {
    return;
  }
  dataUsageStorageDirty = true;
}

void maintainDataUsageStorage() {
  if (!dataUsageStorageDirty) return;
  if (millis() - lastDataUsageSaveMs < DATA_USAGE_SAVE_INTERVAL_MS) return;
  saveDataUsageNow();
}

void saveNetworkProvisioning() {
  prefs.begin("dallmayr", false);
  prefs.putString("wifi_ssid", wifiSsid);
  prefs.putString("wifi_pass", wifiPassword);
  prefs.end();
}

void saveEnrollmentToken() {
  prefs.begin("dallmayr", false);
  if (enrollmentToken.length()) prefs.putString("enroll_token", enrollmentToken);
  else prefs.remove("enroll_token");
  prefs.end();
}

void saveSupabaseAnonKey() {
  prefs.begin("dallmayr", false);
  if (supabaseAnonKey.length()) prefs.putString("supabase_anon", supabaseAnonKey);
  else prefs.remove("supabase_anon");
  prefs.end();
}

void saveAutomaticSimulationTestCompleted(bool completed) {
  prefs.begin("dallmayr", false);
  prefs.putBool("sim_test_ok", completed);
  prefs.end();
  automaticSimulationTestCompleted = completed;
}

void invalidateStaleDeviceCredential() {
  if (!deviceKey.length()) return;
  Serial.println(F("DallmayrERP rejected the stored device credential; starting automatic re-enrollment."));
  deviceKey = "";
  enrollmentToken = DALLMAYR_ENROLLMENT_TOKEN;
  automaticSimulationTestCompleted = false;
  prefs.begin("dallmayr", false);
  prefs.remove("device_key");
  prefs.putString("enroll_token", enrollmentToken);
  prefs.putBool("sim_test_ok", false);
  prefs.end();
  lastEnrollmentAttemptMs = 0;
  lastSimulationUploadMs = 0;
}

void loadCoreSettings() {
  prefs.begin("dallmayr", true);
  apn = prefs.getString("apn", DEFAULT_APN);
  deviceKey = prefs.getString("device_key", "");
  wifiSsid = prefs.getString("wifi_ssid", DALLMAYR_WIFI_SSID);
  wifiPassword = prefs.getString("wifi_pass", DALLMAYR_WIFI_PASSWORD);
  enrollmentToken = prefs.getString("enroll_token", DALLMAYR_ENROLLMENT_TOKEN);
  String storedSupabaseAnonKey = prefs.getString("supabase_anon", "");
  supabaseAnonKey = storedSupabaseAnonKey.length()
    ? storedSupabaseAnonKey
    : String(DALLMAYR_SUPABASE_ANON_KEY);
  bool seedSupabaseAnonKey = !storedSupabaseAnonKey.length() && supabaseAnonKey.length();
  machineInterface = static_cast<MachineInterface>(prefs.getUChar("iface", DALLMAYR_DEFAULT_INTERFACE));
  dexBaud = prefs.getULong("dexbaud", DEFAULT_DEX_BAUD);
  mdbBridgeBaud = prefs.getULong("mdbbaud", DEFAULT_MDB_BRIDGE_BAUD);
  String epoch = prefs.getString("epoch", "");
  String usageEpoch = prefs.getString("usage_epoch", "");
  cellularApplicationTxBytes = prefs.getULong64("cell_app_tx", 0);
  cellularApplicationRxBytes = prefs.getULong64("cell_app_rx", 0);
  wifiApplicationTxBytes = prefs.getULong64("wifi_app_tx", 0);
  wifiApplicationRxBytes = prefs.getULong64("wifi_app_rx", 0);
  automaticSimulationTestCompleted = prefs.getBool("sim_test_ok", false);
  String storedMachineSerial = prefs.getString("machine_sn", "");
  String storedMachineModel = prefs.getString("machine_model", "");
  String storedMachineRevision = prefs.getString("machine_rev", "");
  String storedMachineLocation = prefs.getString("machine_loc", "");
  String storedMachineAsset = prefs.getString("machine_asset", "");
  String storedMachineIdentitySource = prefs.getString("machine_idsrc", "");
  String storedMachineFingerprint = prefs.getString("machine_fp", "");
  prefs.end();

  if (seedSupabaseAnonKey) {
    saveSupabaseAnonKey();
    Serial.println(F("Supabase gateway JWT seeded into NVS from firmware fallback."));
  }

  reportedMachineSerial = String(DALLMAYR_MACHINE_SERIAL).length() ? String(DALLMAYR_MACHINE_SERIAL) : storedMachineSerial;
  reportedMachineModel = storedMachineModel;
  reportedMachineRevision = storedMachineRevision;
  reportedMachineLocation = storedMachineLocation;
  reportedMachineAsset = storedMachineAsset;
  machineIdentitySource = storedMachineIdentitySource;
  machineProfileFingerprint = storedMachineFingerprint;
  // Automatic one-time migration from the old external MDB_BRIDGE mode.
  if (machineInterface == IFACE_MDB_BRIDGE) machineInterface = IFACE_MDB;
  if (!DALLMAYR_MACHINE_IO_ENABLED || !selectableMachineInterface(machineInterface)) {
    machineInterface = IFACE_DISABLED;
  }
  if (dexBaud < 1200 || dexBaud > 115200) dexBaud = DEFAULT_DEX_BAUD;
  if (mdbBridgeBaud < 1200 || mdbBridgeBaud > 921600) {
    mdbBridgeBaud = DEFAULT_MDB_BRIDGE_BAUD;
  }

  if (epoch.length() == 0) {
    makeRandomId(counterEpoch, sizeof(counterEpoch));
    saveCoreSettings();
  } else {
    copyText(counterEpoch, sizeof(counterEpoch), epoch);
  }

  if (usageEpoch.length() == 0) {
    makeRandomId(dataUsageEpoch, sizeof(dataUsageEpoch));
    saveDataUsageNow();
  } else {
    copyText(dataUsageEpoch, sizeof(dataUsageEpoch), usageEpoch);
  }
}

void saveCountersNow() {
  prefs.begin("dallmayr", false);
  prefs.putUShort("counter_n", counterCount);
  prefs.putBytes("counters", counters, sizeof(counters));
  prefs.end();
  counterStorageDirty = false;
  lastCounterSaveMs = millis();
}

void loadCounters() {
  memset(counters, 0, sizeof(counters));
  prefs.begin("dallmayr", true);
  uint16_t storedCount = prefs.getUShort("counter_n", 0);
  counterCount = storedCount > MAX_COUNTERS ? MAX_COUNTERS : storedCount;
  size_t len = prefs.getBytesLength("counters");
  if (len == sizeof(counters)) prefs.getBytes("counters", counters, sizeof(counters));
  prefs.end();

  // Every counter is safe to resend because the backend ingests cumulative values.
  for (uint16_t i = 0; i < counterCount; ++i) {
    if (counters[i].used) counters[i].dirty = true;
  }
}

void maintainCounterStorage() {
  if (!counterStorageDirty) return;
  if (millis() - lastCounterSaveMs < COUNTER_SAVE_DEBOUNCE_MS) return;
  saveCountersNow();
}

// -----------------------------------------------------------------------------
// Counter / fault tables
// -----------------------------------------------------------------------------

CounterEntry* findCounter(const String& selection) {
  for (uint16_t i = 0; i < counterCount; ++i) {
    if (counters[i].used && selection.equalsIgnoreCase(counters[i].selection)) return &counters[i];
  }
  return nullptr;
}

CounterEntry* getCounter(const String& selection) {
  CounterEntry* existing = findCounter(selection);
  if (existing) return existing;
  if (counterCount >= MAX_COUNTERS) return nullptr;

  CounterEntry& c = counters[counterCount++];
  memset(&c, 0, sizeof(c));
  c.used = true;
  c.dirty = true;
  copyText(c.selection, sizeof(c.selection), selection);
  counterStorageDirty = true;
  return &c;
}

void setCumulativeCounter(const String& selection,
                          uint64_t sold,
                          uint64_t revenueCents,
                          uint32_t configuredPriceCents,
                          const String& product) {
  CounterEntry* c = getCounter(selection);
  if (!c) {
    Serial.println(F("Counter table full; DEX product ignored."));
    return;
  }

  bool changed = c->soldTotal != sold || c->revenueCentsTotal != revenueCents ||
                 c->priceCents != configuredPriceCents || product != c->product;
  c->soldTotal = sold;
  c->revenueCentsTotal = revenueCents;
  c->priceCents = configuredPriceCents;
  if (product.length()) copyText(c->product, sizeof(c->product), product);
  if (changed) {
    c->dirty = true;
    counterStorageDirty = true;
    if (String(policy.mode).equalsIgnoreCase("live")) counterUploadRequested = true;
  }
}

void setCompleteCounter(const String& selection,
                        const String& product,
                        uint32_t priceCents,
                        uint64_t sold,
                        uint64_t failed,
                        uint64_t revenueCents) {
  CounterEntry* c = getCounter(selection);
  if (!c) {
    Serial.println(F("Counter table full; machine counter ignored."));
    return;
  }

  bool changed = c->soldTotal != sold || c->failedTotal != failed ||
                 c->revenueCentsTotal != revenueCents ||
                 c->priceCents != priceCents || product != c->product;
  c->soldTotal = sold;
  c->failedTotal = failed;
  c->revenueCentsTotal = revenueCents;
  c->priceCents = priceCents;
  if (product.length()) copyText(c->product, sizeof(c->product), product);
  if (changed) {
    c->dirty = true;
    counterStorageDirty = true;
    if (String(policy.mode).equalsIgnoreCase("live")) counterUploadRequested = true;
  }
}

void incrementLocalVend(const String& selection, uint32_t priceCents, bool success) {
  CounterEntry* c = getCounter(selection);
  if (!c) return;
  if (success) {
    c->soldTotal++;
    c->revenueCentsTotal += priceCents;
  } else {
    c->failedTotal++;
  }
  c->priceCents = priceCents;
  c->dirty = true;
  counterStorageDirty = true;
  if (String(policy.mode).equalsIgnoreCase("live")) counterUploadRequested = true;
}

LocalFault* findFault(const String& code) {
  for (uint8_t i = 0; i < MAX_FAULTS; ++i) {
    if (faults[i].used && code.equalsIgnoreCase(faults[i].code)) return &faults[i];
  }
  return nullptr;
}

LocalFault* getFault(const String& code) {
  LocalFault* f = findFault(code);
  if (f) return f;
  for (uint8_t i = 0; i < MAX_FAULTS; ++i) {
    if (!faults[i].used) {
      memset(&faults[i], 0, sizeof(LocalFault));
      faults[i].used = true;
      copyText(faults[i].code, sizeof(faults[i].code), code);
      return &faults[i];
    }
  }
  return nullptr;
}

// Forward declaration; fault changes use the cellular uploader below.
bool uploadFaultState(const String& code, bool active, const String& severity,
                      const String& source, const String& detail, const String& raw);

void setLocalFaultState(const String& code, bool active, String severity,
                        const String& source, const String& detail, const String& raw) {
  if (code.length() == 0) return;
  severity.toLowerCase();
  LocalFault* f = getFault(code);
  if (!f) return;

  bool stateChanged = f->active != active || !severity.equalsIgnoreCase(f->severity);
  f->active = active;
  copyText(f->severity, sizeof(f->severity), severity);
  if (!stateChanged && !f->pendingUpload) return;

  bool allowedNow = active ? policy.immediateFaults : policy.immediateRecovery;
  if (allowedNow && (cellReady || WiFi.status() == WL_CONNECTED) && uploadFaultState(code, active, severity, source, detail, raw)) {
    f->pendingUpload = false;
  } else {
    f->pendingUpload = true;
  }
}

void flushPendingFaults() {
  if (!cellReady && WiFi.status() != WL_CONNECTED) return;

  // Production backoff: one deferred fault attempt per retry window. The old
  // implementation retried every pending fault on every loop iteration. A 4xx
  // response could therefore keep the modem busy continuously and prevent
  // heartbeat/config servicing.
  uint32_t now = millis();
  if (lastFaultUploadAttemptMs != 0 && now - lastFaultUploadAttemptMs < FAULT_UPLOAD_RETRY_MS) return;

  for (uint8_t i = 0; i < MAX_FAULTS; ++i) {
    LocalFault& f = faults[i];
    if (!f.used || !f.pendingUpload) continue;
    lastFaultUploadAttemptMs = now;
    if (uploadFaultState(f.code, f.active, f.severity, "queued", "Deferred fault state", "")) {
      f.pendingUpload = false;
    } else {
      Serial.println(F("Deferred fault upload failed; backing off for 30 seconds."));
    }
    return; // Never drain multiple failed records in one application-loop pass.
  }
}

// -----------------------------------------------------------------------------
// Air780E/Air780EU AT transport
// -----------------------------------------------------------------------------

void cellDrain(uint32_t quietMs = 50) {
  uint32_t last = millis();
  while (millis() - last < quietMs) {
    while (CellSerial.available()) {
      CellSerial.read();
      last = millis();
    }
    delay(1);
  }
}

String cellReadUntil(uint32_t timeoutMs, const char* token1 = nullptr,
                     const char* token2 = nullptr, bool echoDebug = false,
                     const char* token3 = nullptr,
                     const char* token4 = nullptr) {
  String response;
  uint32_t started = millis();
  while (millis() - started < timeoutMs) {
    while (CellSerial.available()) {
      char c = static_cast<char>(CellSerial.read());
      response += c;
      if (response.length() > 12000) response.remove(0, 3000);
      if (echoDebug) Serial.write(c);
      if (token1 && response.indexOf(token1) >= 0) return response;
      if (token2 && response.indexOf(token2) >= 0) return response;
      if (token3 && response.indexOf(token3) >= 0) return response;
      if (token4 && response.indexOf(token4) >= 0) return response;
    }
    delay(2);
  }
  return response;
}

bool air780BearerWasDeactivated(const String& response) {
  return response.indexOf("+SAPBR 1: DEACT") >= 0 ||
         response.indexOf("+CGEV: NW PDN DEACT") >= 0 ||
         response.indexOf("+PDP: DEACT") >= 0;
}

bool readAir780ExtendedBodyChunk(String& responseBody, bool& bearerDeactivated) {
  CellSerial.print("AT+HTTPEXGET\r\n");
  String read = cellReadUntil(10000, "\r\nOK\r\n", "\r\nERROR\r\n", false,
                              "+CME ERROR:");
  if (air780BearerWasDeactivated(read)) bearerDeactivated = true;
  if (read.indexOf("\r\nOK\r\n") < 0) {
    Serial.println(F("Air780EU extended response body read failed."));
    return false;
  }

  int header = read.indexOf("+HTTPEXGET:");
  if (header < 0) return true;
  int bodyStart = read.indexOf('\n', header);
  if (bodyStart < 0) return true;
  bodyStart++;
  int bodyEnd = read.lastIndexOf("\r\nOK");
  if (bodyEnd < bodyStart) bodyEnd = read.length();
  responseBody += read.substring(bodyStart, bodyEnd);
  return true;
}

bool readAir780ExtendedPostResult(String& responseBody, int& statusCode,
                                  bool& bearerDeactivated) {
  uint32_t started = millis();
  uint8_t responseChunks = 0;
  bearerDeactivated = false;

  while (true) {
    uint32_t elapsed = millis() - started;
    if (elapsed >= AIR780_HTTP_ACTION_WAIT_MS) break;
    uint32_t remaining = AIR780_HTTP_ACTION_WAIT_MS - elapsed;
    String event = cellReadUntil(remaining, "+HTTPEXGET", "+HTTPEXACTION:",
                                 false, "\r\nERROR\r\n", "+CME ERROR:");
    if (air780BearerWasDeactivated(event)) bearerDeactivated = true;
    if (event.indexOf("ERROR\r\n") >= 0 || event.indexOf("+CME ERROR:") >= 0) return false;

    if (event.indexOf("+HTTPEXGET") >= 0) {
      if (++responseChunks > 8) {
        Serial.println(F("Air780EU returned too many extended response chunks."));
        return false;
      }
      if (!readAir780ExtendedBodyChunk(responseBody, bearerDeactivated)) return false;
      continue;
    }

    int actionPos = event.lastIndexOf("+HTTPEXACTION:");
    if (actionPos >= 0) {
      // cellReadUntil returns as soon as it sees the prefix. Read the rest of
      // the result line before parsing `+HTTPEXACTION: 1,<http_status>`.
      if (event.indexOf('\n', actionPos) < 0) {
        event += cellReadUntil(1200, "\n", "ERROR\r\n");
      }
      int comma = event.indexOf(',', actionPos);
      int lineEnd = comma >= 0 ? event.indexOf('\n', comma) : -1;
      if (comma < 0 || lineEnd < 0) return false;
      String status = event.substring(comma + 1, lineEnd);
      status.trim();
      statusCode = status.toInt();
      return statusCode > 0;
    }
  }
  return false;
}

bool cellCommand(const String& command, const char* expected = "OK",
                 uint32_t timeoutMs = 3000, bool tolerateError = false) {
  cellDrain();
  CellSerial.print(command);
  CellSerial.print("\r\n");
  // Match a complete OK result line. With command echo still active, searching
  // for the two letters "OK" could accidentally match inside a URL or secret.
  String successToken = expected;
  if (strcmp(expected, "OK") == 0) successToken = "\r\nOK\r\n";
  String response = cellReadUntil(timeoutMs, successToken.c_str(), "ERROR\r\n");
  if (response.indexOf(successToken) >= 0) return true;
  if (tolerateError && response.indexOf("ERROR") >= 0) return true;
  Serial.print(F("CELL command failed: "));
  bool sensitive = command.startsWith("AT+HTTPPARA=\"USERDATA\"") ||
                   command.startsWith("AT+HTTPPARA=\"USER_DEFINED\"");
  if (sensitive) {
    Serial.println(F("AT+HTTPPARA=<redacted HTTP header>"));
    // The modem can echo the complete rejected AT command even after ATE0.
    // Never print that response because it may contain the private device key.
    int errorPos = response.lastIndexOf("+CME ERROR");
    if (errorPos < 0) errorPos = response.lastIndexOf("ERROR");
    if (errorPos >= 0) {
      String errorLine = response.substring(errorPos);
      int lineEnd = errorLine.indexOf('\n');
      if (lineEnd >= 0) errorLine = errorLine.substring(0, lineEnd);
      errorLine.trim();
      Serial.println(errorLine);
    } else {
      Serial.println(F("Sensitive modem response redacted."));
    }
  } else {
    Serial.println(command);
    Serial.println(response);
  }
  return false;
}

bool cellQueryContains(const String& command, const char* required, uint32_t timeoutMs = 3000) {
  cellDrain();
  CellSerial.print(command);
  CellSerial.print("\r\n");
  String response = cellReadUntil(timeoutMs, "OK", "ERROR");
  return response.indexOf(required) >= 0;
}

int readCellCsq() {
  cellDrain();
  CellSerial.print("AT+CSQ\r\n");
  String response = cellReadUntil(2500, "OK", "ERROR");
  int pos = response.indexOf("+CSQ:");
  if (pos < 0) return -1;
  int comma = response.indexOf(',', pos);
  if (comma < 0) return -1;
  String value = response.substring(pos + 5, comma);
  value.trim();
  return value.toInt();
}

String cellQueryText(const String& command, uint32_t timeoutMs = 3000) {
  cellDrain();
  CellSerial.print(command);
  CellSerial.print("\r\n");
  String response = cellReadUntil(timeoutMs, "OK", "ERROR");
  response.replace("\r", "\n");
  while (response.indexOf("\n\n") >= 0) response.replace("\n\n", "\n");
  response.trim();
  return response;
}

bool parseUnsigned64(const String& value, uint64_t& parsed) {
  String clean = value;
  clean.trim();
  if (!clean.length()) return false;
  for (size_t i = 0; i < clean.length(); ++i) {
    if (!isDigit(clean.charAt(i))) return false;
  }
  parsed = strtoull(clean.c_str(), nullptr, 10);
  return true;
}

int hexNibble(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  return -1;
}

String decodeUcs2Hex(const String& value) {
  if (!value.length() || value.length() % 4 != 0) return value;
  for (size_t i = 0; i < value.length(); ++i) {
    if (hexNibble(value.charAt(i)) < 0) return value;
  }

  String decoded;
  decoded.reserve(value.length() / 4);
  for (size_t i = 0; i < value.length(); i += 4) {
    uint16_t codepoint = static_cast<uint16_t>(
      (hexNibble(value.charAt(i)) << 12)
      | (hexNibble(value.charAt(i + 1)) << 8)
      | (hexNibble(value.charAt(i + 2)) << 4)
      | hexNibble(value.charAt(i + 3))
    );
    if (codepoint == 0) continue;
    if (codepoint <= 0x7F) decoded += static_cast<char>(codepoint);
    else if (codepoint <= 0x7FF) {
      decoded += static_cast<char>(0xC0 | (codepoint >> 6));
      decoded += static_cast<char>(0x80 | (codepoint & 0x3F));
    } else {
      decoded += static_cast<char>(0xE0 | (codepoint >> 12));
      decoded += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F));
      decoded += static_cast<char>(0x80 | (codepoint & 0x3F));
    }
  }
  return decoded;
}

String extractUssdPayload(const String& response) {
  int marker = response.lastIndexOf("+CUSD:");
  if (marker < 0) return "";
  int firstQuote = response.indexOf('"', marker);
  if (firstQuote >= 0) {
    int lastQuote = response.indexOf('"', firstQuote + 1);
    if (lastQuote > firstQuote) {
      String payload = response.substring(firstQuote + 1, lastQuote);
      payload.replace("\\\"", "\"");
      payload.trim();
      return decodeUcs2Hex(payload);
    }
  }

  int lineEnd = response.indexOf('\n', marker);
  if (lineEnd < 0) lineEnd = response.length();
  String payload = response.substring(marker + 6, lineEnd);
  int comma = payload.lastIndexOf(',');
  if (comma >= 0) payload = payload.substring(0, comma);
  payload.trim();
  return decodeUcs2Hex(payload);
}

bool parseDataBalanceBytes(const String& response, uint64_t& totalBytes) {
  String upper = response;
  upper.toUpperCase();
  double total = 0.0;
  uint16_t valuesFound = 0;

  for (size_t i = 0; i < upper.length();) {
    if (!isDigit(upper.charAt(i))) { ++i; continue; }
    size_t numberStart = i;
    bool decimalSeen = false;
    while (i < upper.length()) {
      char c = upper.charAt(i);
      if (isDigit(c)) { ++i; continue; }
      if ((c == '.' || c == ',') && !decimalSeen) { decimalSeen = true; ++i; continue; }
      break;
    }
    String numberText = upper.substring(numberStart, i);
    numberText.replace(',', '.');
    while (i < upper.length() && isSpace(upper.charAt(i))) ++i;

    double multiplier = 0.0;
    if (upper.substring(i).startsWith("GB")) multiplier = 1024.0 * 1024.0 * 1024.0;
    else if (upper.substring(i).startsWith("MB")) multiplier = 1024.0 * 1024.0;
    else if (upper.substring(i).startsWith("KB")) multiplier = 1024.0;
    else if (upper.substring(i).startsWith("BYTES")) multiplier = 1.0;

    if (multiplier > 0.0) {
      double amount = strtod(numberText.c_str(), nullptr);
      if (amount >= 0.0 && amount <= 1048576.0) {
        total += amount * multiplier;
        ++valuesFound;
      }
    }
  }

  if (valuesFound == 0) {
    if (upper.indexOf("NO DATA") >= 0 || upper.indexOf("DATA BALANCE IS 0") >= 0) {
      totalBytes = 0;
      return true;
    }
    return false;
  }

  if (total > static_cast<double>(UINT64_MAX)) return false;
  totalBytes = static_cast<uint64_t>(total + 0.5);
  return true;
}

void queryVodacomPrepaidBalance() {
  // Air780EU V1180 returns ERROR for CUSD/USSD requests. The current OpenLuat
  // Air780E AT command set also does not expose CUSD. Treat live carrier balance
  // as unavailable on this modem rather than disturbing a working PPP session.
  prepaidBalanceAvailable = false;
  prepaidBalanceStatus = "unsupported_modem_firmware";
  prepaidBalanceText = "";
  prepaidBalanceError = "Air780EU V1180 AT firmware does not support the required USSD balance query";
  lastPrepaidBalanceCheckMs = millis();
  prepaidBalanceReportPending = true;
  policy.prepaidBalanceDue = false;
  heartbeatUploadRequested = true;

  Serial.println(F("Vodacom prepaid balance unavailable on Air780EU V1180: USSD is unsupported."));
  Serial.println(F("PPP/data telemetry remains active; use Vodacom self-service externally for live balance."));
}

void servicePrepaidBalance() {
  // Intentionally no automatic modem command. Keep the backend/web-app status
  // explicit and stable without interrupting production PPP.
  if (prepaidBalanceStatus != "unsupported_modem_firmware") {
    prepaidBalanceAvailable = false;
    prepaidBalanceStatus = "unsupported_modem_firmware";
    prepaidBalanceText = "";
    prepaidBalanceError = "Air780EU V1180 AT firmware does not support USSD balance queries";
    prepaidBalanceReportPending = true;
    policy.prepaidBalanceDue = false;
  }
}

bool readCellModemDataUsage(bool printResult = false) {
  if (pppStarted) {
    cellularModemUsageAvailable = false;
    if (printResult) Serial.println(F("Air780E modem byte counters unavailable while PPP data mode owns UART1."));
    return false;
  }
  String response = cellQueryText("AT^DATAINFO", 4000);
  int marker = response.indexOf("^DATAINFO:");
  if (marker < 0) {
    cellularModemUsageAvailable = false;
    if (printResult) Serial.println(F("Air780E modem data counter is unavailable."));
    return false;
  }

  int comma = response.indexOf(',', marker);
  int lineEnd = response.indexOf('\n', comma + 1);
  if (comma < 0) {
    cellularModemUsageAvailable = false;
    return false;
  }
  if (lineEnd < 0) lineEnd = response.length();

  uint64_t tx = 0;
  uint64_t rx = 0;
  String txText = response.substring(marker + 10, comma);
  String rxText = response.substring(comma + 1, lineEnd);
  rxText.replace("OK", "");
  if (!parseUnsigned64(txText, tx) || !parseUnsigned64(rxText, rx)) {
    cellularModemUsageAvailable = false;
    if (printResult) Serial.println(F("Air780E modem data counter response could not be parsed."));
    return false;
  }

  cellularModemTxBytes = tx;
  cellularModemRxBytes = rx;
  cellularModemUsageAvailable = true;
  lastCellularModemUsageSampleMs = millis();
  if (printResult) {
    char valueBuffer[24] = {0};
    snprintf(valueBuffer, sizeof(valueBuffer), "%llu", static_cast<unsigned long long>(tx));
    Serial.print(F("Air780E network TX total: ")); Serial.print(valueBuffer); Serial.println(F(" B"));
    snprintf(valueBuffer, sizeof(valueBuffer), "%llu", static_cast<unsigned long long>(rx));
    Serial.print(F("Air780E network RX total: ")); Serial.print(valueBuffer); Serial.println(F(" B"));
  }
  return true;
}

bool enableCellModemDataUsage() {
  // Air780E AT^DATAINFO counters include cellular protocol traffic and persist
  // in the modem. A 30-second save period is the module's supported minimum.
  if (!cellCommand("AT^DATAINFO=1,30", "OK", 3000)) {
    Serial.println(F("WARNING: Air780E firmware did not enable AT^DATAINFO counters."));
    cellularModemUsageAvailable = false;
    return false;
  }
  return readCellModemDataUsage(true);
}

String readCellModel() {
  String response = cellQueryText("AT+CGMM");
  response.replace("AT+CGMM", "");
  response.replace("OK", "");
  response.trim();
  int firstNl = response.indexOf('\n');
  if (firstNl >= 0) response = response.substring(0, firstNl);
  response.trim();
  return response;
}

String readCellFirmware() {
  String response = cellQueryText("AT+CGMR", 4000);
  response.replace("AT+CGMR", "");
  response.replace("OK", "");
  response.trim();
  int firstNl = response.indexOf('\n');
  if (firstNl >= 0) response = response.substring(0, firstNl);
  response.trim();
  return response;
}

String readCellOperator() {
  String response = cellQueryText("AT+COPS?");
  int q1 = response.indexOf('"');
  int q2 = q1 >= 0 ? response.indexOf('"', q1 + 1) : -1;
  if (q1 >= 0 && q2 > q1) return response.substring(q1 + 1, q2);
  int pos = response.indexOf("+COPS:");
  if (pos >= 0) {
    String out = response.substring(pos + 6);
    int nl = out.indexOf('\n');
    if (nl >= 0) out = out.substring(0, nl);
    out.trim();
    return out;
  }
  return "";
}

bool recoverAir780CommandMode(bool verbose = true) {
  // OpenLuat requires a guard interval around +++ when leaving PPP/data mode:
  // >=1 s silence before, send exactly +++ with NO CR/LF, then >=0.5 s silence.
  // ATH must follow to hang up the PPP call, otherwise the next dial can fail.
  if (verbose) Serial.println(F("Attempting guarded Air780EU manual PPP/data-mode escape..."));

  cellDrain();
  delay(1200);
  CellSerial.print("+++");
  CellSerial.flush();
  delay(700);

  String escapeResponse = cellReadUntil(2500, "\r\nOK\r\n", "NO CARRIER",
                                        false, "\r\nERROR\r\n");
  if (verbose && escapeResponse.length()) {
    String printable = escapeResponse;
    printable.replace("\r", " ");
    printable.replace("\n", " ");
    Serial.print(F("PPP escape response: "));
    Serial.println(printable);
  }

  cellDrain();
  CellSerial.print("ATH\r\n");
  String hangup = cellReadUntil(3500, "\r\nOK\r\n", "NO CARRIER",
                                false, "\r\nERROR\r\n");
  if (verbose && hangup.length()) {
    String printable = hangup;
    printable.replace("\r", " ");
    printable.replace("\n", " ");
    Serial.print(F("PPP hang-up response: "));
    Serial.println(printable);
  }

  // V6.8.31 proved the Air780EU can take several AT probes after ATH before
  // command mode is fully responsive. Wait, then try up to five times.
  delay(1500);
  bool recovered = false;
  for (uint8_t attempt = 0; attempt < 5 && !recovered; ++attempt) {
    cellDrain();
    CellSerial.print("AT\r\n");
    String probe = cellReadUntil(3000, "OK", "ERROR", true);
    if (probe.indexOf("OK") >= 0) {
      recovered = true;
      if (verbose && attempt > 0) {
        Serial.print(F("Air780EU answered AT on recovery attempt "));
        Serial.println(attempt + 1);
      }
      break;
    }
    delay(400);
  }

  if (recovered) {
    // Keep modem sleep disabled while the production PPP path is active.
    cellCommand("AT+CSCLK=0", "OK", 3000, true);
  }

  if (verbose) {
    Serial.println(recovered
      ? F("Air780EU command mode recovered.")
      : F("Air780EU command-mode recovery did not obtain AT/OK after 5 probes."));
  }
  return recovered;
}

bool ensureAir780PppCid1Apn() {
  const char* desiredApn = apn.length() ? apn.c_str() : DEFAULT_APN;
  String pdpStatus = cellQueryText("AT+CGDCONT?", 3000);
  String expectedCid1 = String("+CGDCONT: 1,\"IP\",\"") + desiredApn + "\"";

  if (pdpStatus.indexOf(expectedCid1) >= 0) {
    Serial.print(F("PPP CID1 APN already correct; preserving active PDP state: "));
    Serial.println(desiredApn);
    return true;
  }

  Serial.print(F("PPP CID1 APN differs from desired value; reconfiguring CID1 to: "));
  Serial.println(desiredApn);

  // Only tear CID1 down when an APN change is actually necessary.
  String activeStatus = cellQueryText("AT+CGACT?", 3000);
  if (activeStatus.indexOf("+CGACT: 1,1") >= 0) {
    if (!cellCommand("AT+CGACT=0,1", "OK", 6000, true)) {
      Serial.println(F("PPP CID1 could not be deactivated for APN change."));
      return false;
    }
    delay(500);
  }

  String pdpCmd = String("AT+CGDCONT=1,\"IP\",\"") + desiredApn + "\"";
  if (!cellCommand(pdpCmd, "OK", 3500)) {
    Serial.println(F("Air780EU could not configure PPP PDP context 1."));
    return false;
  }

  String verify = cellQueryText("AT+CGDCONT?", 3000);
  bool configured = verify.indexOf(expectedCid1) >= 0;
  Serial.print(F("PPP CID1 APN verification: "));
  Serial.println(configured ? "ok" : "failed");
  return configured;
}

bool initializeCellular() {
  Serial.println(F("Initialising Air780E/Air780EU..."));
  // A modem restart or a new cellular initialization can discard or retain a
  // partial SSL context. Re-apply the complete HTTPS context after attachment.
  air780TlsConfigured = false;
  air780TlsConfigurationAttempts = 0;
  if (!cellCommand("AT", "OK", 1500)) {
    Serial.println(F("Air780EU did not answer AT; it may still be in PPP/data mode from a previous ESP32 reset."));
    if (!recoverAir780CommandMode(true)) return false;
  }
  // The successful V6.8.31 diagnostic always disabled modem sleep before
  // PPP. Do this on every normal initialization, not only after +++/ATH recovery.
  cellCommand("AT+CSCLK=0", "OK", 3000, true);

  // V1180 has been observed echoing commands even after a nominal ATE0.
  // Send both accepted spellings before PPP and verify again immediately
  // before dialing.
  cellCommand("ATE0", "OK", 1500, true);
  cellCommand("ATE 0", "OK", 1500, true);
  cellCommand("AT+CMEE=2", "OK", 1500, true);
  cellularModel = readCellModel();
  if (cellularModel.length()) {
    Serial.print(F("Cellular model: "));
    Serial.println(cellularModel);
    String upperModel = cellularModel;
    upperModel.toUpperCase();
    if (upperModel.indexOf("AIR780E") >= 0 && upperModel.indexOf("AIR780EU") < 0) {
      Serial.println(F("WARNING: plain Air780E is not the EMEA/Africa variant. Air780EU is recommended for South Africa."));
    }
  }
  cellularFirmware = readCellFirmware();
  if (cellularFirmware.length()) {
    Serial.print(F("Cellular firmware: "));
    Serial.println(cellularFirmware);
  }

  if (!cellQueryContains("AT+CPIN?", "READY", 3000)) {
    Serial.println(F("SIM is not ready."));
    return false;
  }

  // Allow network registration/attachment to settle.
  for (int attempt = 0; attempt < 12; ++attempt) {
    if (cellQueryContains("AT+CGATT?", "+CGATT: 1", 2500)) break;
    delay(2500);
    if (attempt == 11) {
      Serial.println(F("Cellular packet service is not attached."));
      return false;
    }
  }

  // Log both EPS and packet registration. Roaming is acceptable; the active
  // operator is shown by STATUS and returned with telemetry for verification.
  String epsRegistration = cellQueryText("AT+CEREG?", 2500);
  String packetRegistration = cellQueryText("AT+CGREG?", 2500);
  Serial.print(F("EPS registration: ")); Serial.println(epsRegistration);
  Serial.print(F("Packet registration: ")); Serial.println(packetRegistration);

  // V6.8.31 diagnostic succeeded without touching SAPBR at all. Preserve the
  // modem's current PDP/bearer state before PPP and only verify CID1/APN below.

  if (!ensureAir780PppCid1Apn()) return false;

  String pdpStatus = cellQueryText("AT+CGDCONT?", 3000);
  Serial.print(F("PPP PDP context: ")); Serial.println(pdpStatus);

  cellularOperator = readCellOperator();
  cellularCsq = readCellCsq();
  Serial.print(F("Air780E/Air780EU registered. CSQ="));
  Serial.println(cellularCsq);
  // Do not touch AT^DATAINFO before PPP negotiation. The isolated V6.8.31
  // success path did not use it; sample/enable counters only after PPP is up.
  cellularModemUsageAvailable = false;
  cellModemRegistered = true;
  cellReady = false;
  return true;
}

void restoreCellAtUart() {
  if (!CellSerial) {
    CellSerial.begin(CELL_BAUD, SERIAL_8N1, CELL_RX_PIN, CELL_TX_PIN);
  }
  delay(120);
}

bool airPppHasIp() {
  // The TCP/IP-thread status callback owns the authoritative link/IP state.
  // Application tasks read only this cached state instead of touching lwIP's
  // raw netif fields without the core lock.
  return pppOnline && airPppPcb != nullptr && airPppIpAddress[0] != '\0';
}

String airPppIpText() {
  return airPppHasIp() ? String(airPppIpAddress) : String();
}

const char* airPppAuthUsername() {
  return airPppAuthProfileIndex == 0
    ? VODACOM_PPP_USERNAME_BLANK
    : VODACOM_PPP_USERNAME_GUEST;
}

const char* airPppAuthProfileName() {
  return airPppAuthProfileIndex == 0
    ? "PAP blank/blank"
    : "PAP guest/blank";
}

void applyAirPppAuthenticationLocked() {
#if PAP_SUPPORT
  ppp_set_auth(
    airPppPcb,
    PPPAUTHTYPE_PAP,
    airPppAuthUsername(),
    VODACOM_PPP_PASSWORD
  );
#endif
}

void applyVerifiedAirPppNegotiationProfileLocked() {
#if PPP_IPV4_SUPPORT
  // Proven by DallmayrCellularDiagnostic V6.8.31 against Vodacom 65501:
  // dynamic local/remote IPv4, peer DNS, no preset address.
  airPppPcb->ipcp_wantoptions.ouraddr = 0;
  airPppPcb->ipcp_wantoptions.hisaddr = 0;
  airPppPcb->ipcp_wantoptions.accept_local = 1;
  airPppPcb->ipcp_wantoptions.accept_remote = 1;
  airPppPcb->ask_for_local = 1;

#if VJ_SUPPORT
  // OpenLuat-compatible novj / novjccomp.
  airPppPcb->ipcp_wantoptions.neg_vj = 0;
  airPppPcb->ipcp_wantoptions.old_vj = 0;
  airPppPcb->ipcp_wantoptions.cflag = 0;
  airPppPcb->ipcp_allowoptions.neg_vj = 0;
  airPppPcb->ipcp_allowoptions.old_vj = 0;
  airPppPcb->ipcp_allowoptions.cflag = 0;
#endif
#endif

#if CCP_SUPPORT
  // OpenLuat-compatible noccp behavior.
  memset(&airPppPcb->ccp_wantoptions, 0, sizeof(airPppPcb->ccp_wantoptions));
  memset(&airPppPcb->ccp_allowoptions, 0, sizeof(airPppPcb->ccp_allowoptions));
#endif
}


void printAirPppIp4(const uint8_t* p) {
  Serial.print(p[0]); Serial.print('.');
  Serial.print(p[1]); Serial.print('.');
  Serial.print(p[2]); Serial.print('.');
  Serial.print(p[3]);
}

const char* airPppCtrlCodeName(uint8_t code) {
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

void traceAirPppIpcpOptions(const uint8_t* p, size_t len) {
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
        if (optLen >= 6) printAirPppIp4(&p[i + 2]);
        break;
      case 129:
        Serial.print(F("DNS1="));
        if (optLen >= 6) printAirPppIp4(&p[i + 2]);
        break;
      case 131:
        Serial.print(F("DNS2="));
        if (optLen >= 6) printAirPppIp4(&p[i + 2]);
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

void traceAirPppControlFrame(const char* direction, const uint8_t* frame, size_t len) {
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
    Serial.print(airPppCtrlCodeName(code));
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
    Serial.print(airPppCtrlCodeName(code));
    Serial.print(F(" id="));
    Serial.println(id);
    if (ctrlLen > 4) traceAirPppIpcpOptions(&frame[i + 4], ctrlLen - 4);
    return;
  }

  if (protocol == 0x80FD) {
    Serial.print(F("[PPP "));
    Serial.print(direction);
    Serial.print(F("] CCP "));
    Serial.print(airPppCtrlCodeName(code));
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

void traceAirPppBytes(AirPppTraceState& state, const char* direction, const uint8_t* data, size_t len) {
  for (size_t n = 0; n < len; ++n) {
    uint8_t b = data[n];
    if (b == 0x7E) {
      if (state.inFrame && state.len >= 4) {
        traceAirPppControlFrame(direction, state.frame, state.len);
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

const char* airPppPhaseName(u8_t phase) {
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

#if PPP_NOTIFY_PHASE
static void airPppPhaseCallback(ppp_pcb* pcb, u8_t phase, void* ctx) {
  (void)pcb;
  (void)ctx;
  airPppPhase = phase;
  Serial.print(F("PPP phase: "));
  Serial.println(airPppPhaseName(phase));
}
#endif

void printAirPppNegotiationSnapshot() {
  if (!airPppPcb) return;
  LOCK_TCPIP_CORE();
  Serial.print(F("[PPP SNAPSHOT] phase="));
  Serial.print(airPppPhaseName(airPppPhase));
  Serial.print(F(" lcp_state="));
  Serial.print(airPppPcb->lcp_fsm.state);
#if PPP_IPV4_SUPPORT
  Serial.print(F(" ipcp_state="));
  Serial.print(airPppPcb->ipcp_fsm.state);
  Serial.print(F(" ouraddr=0x"));
  Serial.print(airPppPcb->ipcp_gotoptions.ouraddr, HEX);
  Serial.print(F(" hisaddr=0x"));
  Serial.print(airPppPcb->ipcp_gotoptions.hisaddr, HEX);
  Serial.print(F(" accept_local="));
  Serial.print(airPppPcb->ipcp_wantoptions.accept_local);
  Serial.print(F(" accept_remote="));
  Serial.print(airPppPcb->ipcp_wantoptions.accept_remote);
#endif
  Serial.println();
  UNLOCK_TCPIP_CORE();
}

bool selectAirPppAsDefault() {
  if (airPppPcb == nullptr || !airPppHasIp()) return false;
  LOCK_TCPIP_CORE();
  ppp_set_default(airPppPcb);
  UNLOCK_TCPIP_CORE();
  return true;
}

static u32_t airPppOutputCallback(ppp_pcb* pcb, const void* data, u32_t len, void* ctx) {
  (void)pcb;
  (void)ctx;
  if (!data || len == 0) return 0;
  const uint8_t* bytes = static_cast<const uint8_t*>(data);
  traceAirPppBytes(airPppTxTrace, "TX", bytes, len);
  size_t written = CellSerial.write(bytes, len);
  airPppUartTxBytes += written;
  return static_cast<u32_t>(written);
}

static void airPppStatusCallback(ppp_pcb* pcb, int errCode, void* ctx) {
  (void)ctx;
  airPppLastError = errCode;

  if (errCode == PPPERR_NONE) {
    struct netif* nif = ppp_netif(pcb);
    if (nif != nullptr) {
      netif_set_default(nif);
      char value[20] = {0};
      ip4addr_ntoa_r(netif_ip4_addr(nif), value, sizeof(value));
      strncpy(airPppIpAddress, value, sizeof(airPppIpAddress) - 1);
      airPppIpAddress[sizeof(airPppIpAddress) - 1] = '\0';
    }
    pppOnline = true;
    cellReady = true;
    Serial.print(F("PPP status: UP ip="));
    Serial.println(airPppIpAddress);
    return;
  }

  pppOnline = false;
  cellReady = false;
  airPppIpAddress[0] = '\0';

  if (errCode == PPPERR_AUTHFAIL) {
    if (airPppAuthProfileIndex == 0) {
      airPppAuthProfileIndex = 1;
      airPppAuthProfileExhausted = false;
      Serial.println(F("PPP PAP blank/blank was rejected; next retry will use guest/blank."));
    } else {
      airPppAuthProfileExhausted = true;
      Serial.println(F("PPP PAP guest/blank was also rejected; both Vodacom PAP credential profiles have failed."));
    }
  }

  Serial.print(F("PPP status: DOWN err="));
  Serial.print(errCode);
  Serial.print(F(" phase="));
  Serial.println(airPppPhaseName(airPppPhase));
}

static void airPppRxTask(void* parameter) {
  (void)parameter;
  uint8_t buffer[512];

  while (airPppRxTaskRun) {
    int available = CellSerial.available();
    if (available <= 0) {
      vTaskDelay(pdMS_TO_TICKS(1));
      continue;
    }

    size_t wanted = static_cast<size_t>(available);
    if (wanted > sizeof(buffer)) wanted = sizeof(buffer);
    size_t received = CellSerial.readBytes(buffer, wanted);
    if (received > 0) {
      airPppUartRxBytes += received;
      traceAirPppBytes(airPppRxTrace, "RX", buffer, received);
      if (airPppPcb != nullptr) {
        // Thread-safe PPPoS input path: bytes are delivered to lwIP's TCP/IP
        // thread in chunks while HTTPS may be blocking in another task.
        pppos_input_tcpip(airPppPcb, buffer, static_cast<int>(received));
      }
    }
  }

  airPppRxTaskHandle = nullptr;
  vTaskDelete(nullptr);
}

bool ensureAirPppControlBlock() {
  if (airPppPcb != nullptr && airPppControlBlockReady) return true;

  // The netif/control block is created exactly once for the lifetime of this
  // ESP32 boot. Retries reuse it; this prevents netif_add("already added")
  // assertions caused by freeing/recreating the same struct netif incorrectly.
  memset(&airPppNetif, 0, sizeof(airPppNetif));
  airPppIpAddress[0] = '\0';
  airPppLastError = PPPERR_NONE;
  airPppPhase = PPP_PHASE_DEAD;
  airPppTxTrace = AirPppTraceState();
  airPppRxTrace = AirPppTraceState();

  Serial.println(F("Creating persistent lwIP PPPoS control block under TCP/IP core lock."));
  LOCK_TCPIP_CORE();
  airPppPcb = pppos_create(
    &airPppNetif,
    airPppOutputCallback,
    airPppStatusCallback,
    nullptr
  );
  if (airPppPcb != nullptr) {
    ppp_set_usepeerdns(airPppPcb, 1);
#if PAP_SUPPORT
    applyAirPppAuthenticationLocked();
#endif
    applyVerifiedAirPppNegotiationProfileLocked();
#if PPP_NOTIFY_PHASE
    ppp_set_notify_phase_callback(airPppPcb, airPppPhaseCallback);
#endif
  }
  UNLOCK_TCPIP_CORE();

  if (airPppPcb == nullptr) {
    Serial.println(F("lwIP could not create the persistent Air780EU PPPoS control block."));
    airPppControlBlockReady = false;
    return false;
  }

#if PAP_SUPPORT
  Serial.print(F("PPP authentication configured: "));
  Serial.println(airPppAuthProfileName());
#else
  Serial.println(F("ERROR: this Arduino-ESP32 build has PPP PAP support disabled."));
  airPppControlBlockReady = false;
  return false;
#endif

  airPppControlBlockReady = true;
  return true;
}

void stopAirPppRxTask() {
  airPppRxTaskRun = false;
  uint32_t waitStarted = millis();
  while (airPppRxTaskHandle != nullptr && millis() - waitStarted < 1200UL) {
    delay(10);
  }
}

void closeAirPppSession() {
  if (airPppPcb == nullptr || !pppStarted) {
    stopAirPppRxTask();
    pppStarted = false;
    pppOnline = false;
    cellReady = false;
    airPppIpAddress[0] = '\0';
    return;
  }

  // Keep RX alive while lwIP transitions the existing PPP PCB to DEAD.
  LOCK_TCPIP_CORE();
  ppp_close(airPppPcb, 1);
  UNLOCK_TCPIP_CORE();

  uint32_t closeStarted = millis();
  while (airPppPhase != PPP_PHASE_DEAD && millis() - closeStarted < 2000UL) {
    delay(20);
  }

  stopAirPppRxTask();
  pppStarted = false;
  pppOnline = false;
  cellReady = false;
  airPppIpAddress[0] = '\0';

  Serial.print(F("PPP session closed; reusable control block retained. phase="));
  Serial.println(airPppPhaseName(airPppPhase));
}

void stopCellularPpp(bool restoreAt = true) {
  closeAirPppSession();
  cellularModemUsageAvailable = false;

  if (restoreAt) {
    restoreCellAtUart();
    recoverAir780CommandMode(false);
  }
}

bool dialAir780PppDataMode() {
  // The AT side is already registered and CID1 is configured. Dial manually so
  // no generic esp-modem DCE can transform or loop the PPP byte stream.
  cellDrain();
  CellSerial.print("ATD*99#\r");
  String response = cellReadUntil(15000, "CONNECT", "NO CARRIER",
                                  false, "\r\nERROR\r\n", "+CME ERROR:");
  if (response.indexOf("CONNECT") >= 0) {
    Serial.println(F("Air780EU returned CONNECT; UART is now raw PPP data."));
    return true;
  }

  Serial.println(F("Air780EU did not enter PPP data mode."));
  if (response.length()) {
    String printable = response;
    printable.replace("\r", " ");
    printable.replace("\n", " ");
    Serial.print(F("PPP dial response: "));
    Serial.println(printable);
  }
  return false;
}

bool startCellularPpp() {
  if (airPppHasIp()) {
    cellReady = true;
    return true;
  }

  if (!cellModemRegistered) return false;
  if (pppStarted || airPppPcb != nullptr) stopCellularPpp(true);

  // Preserve the active Vodacom CID1/PDP state exactly as in the successful
  // isolated V6.8.31 diagnostic. Do not issue SAPBR or CGACT here.

  const char* pppApn = apn.length() ? apn.c_str() : DEFAULT_APN;
  if (!cellCommand("ATE0", "OK", 2000, true)
      || !ensureAir780PppCid1Apn()) {
    Serial.println(F("Air780EU manual PPP preflight failed before dial."));
    return false;
  }

  Serial.print(F("Starting manual Air780EU lwIP PPPoS on APN: "));
  Serial.println(pppApn);

  airPppLastError = PPPERR_NONE;
  airPppUartTxBytes = 0;
  airPppUartRxBytes = 0;
  airPppIpAddress[0] = '\0';
  airPppPhase = PPP_PHASE_DEAD;

  if (!ensureAirPppControlBlock()) {
    cellModemRegistered = false;
    return false;
  }

  // Re-apply the carrier profile before each session. Start with blank/blank
  // PAP; if Vodacom rejects it, the status callback advances to guest/blank.
  if (airPppAuthProfileIndex == 0) airPppAuthProfileExhausted = false;
  Serial.print(F("PPP PAP profile for this attempt: "));
  Serial.println(airPppAuthProfileName());

  Serial.println(F("PPP options: dynamic IPCP + peer DNS + no VJ/CCP (verified V6.8.31 profile)."));
  LOCK_TCPIP_CORE();
#if PAP_SUPPORT
  applyAirPppAuthenticationLocked();
#endif
  ppp_set_usepeerdns(airPppPcb, 1);
  applyVerifiedAirPppNegotiationProfileLocked();
  UNLOCK_TCPIP_CORE();

  if (!dialAir780PppDataMode()) {
    recoverAir780CommandMode(false);
    cellModemRegistered = false;
    return false;
  }

  pppStarted = true;
  pppStartedAtMs = millis();
  airPppRxTaskRun = true;
  BaseType_t taskCreated = xTaskCreatePinnedToCore(
    airPppRxTask,
    "air780_ppp_rx",
    6144,
    nullptr,
    3,
    &airPppRxTaskHandle,
    0
  );
  if (taskCreated != pdPASS) {
    Serial.println(F("Could not start the Air780EU manual PPP UART receive task."));
    airPppRxTaskRun = false;
    closeAirPppSession();
    recoverAir780CommandMode(false);
    cellModemRegistered = false;
    return false;
  }

  // Give the pinned RX task time to start consuming the first modem PPP frames,
  // matching the successful V6.8.31 diagnostic sequence.
  delay(20);

  Serial.print(F("PPP connect starting from phase="));
  Serial.println(airPppPhaseName(airPppPhase));
  LOCK_TCPIP_CORE();
  err_t connectResult = ppp_connect(airPppPcb, 0);
  UNLOCK_TCPIP_CORE();
  if (connectResult != ERR_OK) {
    Serial.print(F("lwIP PPP connect call failed err="));
    Serial.println(static_cast<int>(connectResult));
    stopCellularPpp(true);
    cellModemRegistered = false;
    return false;
  }

  uint32_t ipStart = millis();
  uint32_t lastSnapshotMs = 0;
  while (!airPppHasIp() && millis() - ipStart < PPP_CONNECT_TIMEOUT_MS) {
    if (millis() - lastSnapshotMs >= 10000UL) {
      lastSnapshotMs = millis();
      printAirPppNegotiationSnapshot();
    }
    delay(100);
  }

  if (!airPppHasIp()) {
    Serial.print(F("Manual Air780EU PPP negotiation failed. auth_profile="));
    Serial.print(airPppAuthProfileName());
    Serial.print(F(" phase="));
    Serial.print(airPppPhaseName(airPppPhase));
    Serial.print(F(" lwIP_error="));
    Serial.print(static_cast<int>(airPppLastError));
    if (airPppPhase == PPP_PHASE_AUTHENTICATE) {
      Serial.print(F(" (stalled during PAP authentication)"));
    } else if (airPppPhase == PPP_PHASE_NETWORK) {
      Serial.print(F(" (stalled during IPCP/network negotiation)"));
    }
    Serial.print(F(" uart_tx="));
    Serial.print(static_cast<unsigned long long>(airPppUartTxBytes));
    Serial.print(F(" uart_rx="));
    Serial.println(static_cast<unsigned long long>(airPppUartRxBytes));
    stopCellularPpp(true);
    cellModemRegistered = false;
    return false;
  }

  pppOnline = true;
  cellReady = true;
  cellularModemUsageAvailable = false;

  Serial.print(F("Manual Air780EU PPP connected. ESP32 cellular IP: "));
  Serial.println(airPppIpText());
  Serial.print(F("PPP raw UART bytes TX/RX: "));
  Serial.print(static_cast<unsigned long long>(airPppUartTxBytes));
  Serial.print('/');
  Serial.println(static_cast<unsigned long long>(airPppUartRxBytes));
  Serial.println(F("ESP32 NetworkClientSecure now carries Supabase TLS over raw lwIP PPPoS."));

  // AT^DATAINFO sampling is intentionally deferred while PPP owns the UART.
  // Application byte counters continue to track cellular usage immediately.
  return true;
}

bool ensureCellularPpp() {
  if (airPppHasIp()) {
    pppOnline = true;
    cellReady = true;
    return true;
  }

  if (pppStarted || airPppPcb != nullptr) {
    stopCellularPpp(true);
    cellModemRegistered = false;
  }

  if (!cellModemRegistered && !initializeCellular()) return false;
  return startCellularPpp();
}

void maintainCellular() {
  String preferredTransport = policy.transportPreference;
  preferredTransport.toLowerCase();
  bool wifiIsPrimary = policy.wifiEnabled
    && wifiSsid.length()
    && preferredTransport != "cellular";

  if (wifiIsPrimary && wifiReady()) {
    if (pppStarted) {
      Serial.println(F("Wi-Fi primary is healthy; closing standby PPP session."));
      stopCellularPpp(true);
      cellModemRegistered = false;
    }
    return;
  }

  if (wifiIsPrimary && !pppStarted && wifiBeginIssued && wifiConnectionStartedMs != 0
      && millis() - wifiConnectionStartedMs < WIFI_PRIMARY_GRACE_MS) {
    return;
  }

  if (pppOnline || pppStarted) {
    if (airPppHasIp()) {
      pppOnline = true;
      cellReady = true;
      return;
    }

    if (pppStarted && millis() - pppStartedAtMs < PPP_CONNECT_TIMEOUT_MS) return;

    Serial.println(F("Manual Air780EU PPP link is down; recovering command mode."));
    stopCellularPpp(true);
    cellModemRegistered = false;
  }

  if (millis() - lastCellAttemptMs < CELL_RETRY_MS) return;
  lastCellAttemptMs = millis();
  ensureCellularPpp();
}

bool air780HttpsStateIsEnabled(String response) {
  response.replace(" ", "");
  return response.indexOf("+HTTPSSL:1") >= 0;
}

bool enableAir780Https() {
  String sslState = cellQueryText("AT+HTTPSSL?", 3000);
  if (air780HttpsStateIsEnabled(sslState)) {
    Serial.println(F("Air780E HTTPS was already enabled."));
    return true;
  }

  if (cellCommand("AT+HTTPSSL=1", "OK", 3500)) return true;

  // Air780EU V1180 may enable HTTPS but return a non-standard response. Only
  // accept that case when the follow-up query proves that HTTPS is enabled.
  delay(350);
  sslState = cellQueryText("AT+HTTPSSL?", 3000);
  if (air780HttpsStateIsEnabled(sslState)) {
    Serial.println(F("Air780E HTTPS verified enabled after a non-standard command response."));
    return true;
  }
  return false;
}

bool configureAir780TlsContext() {
  if (air780TlsConfigured) return true;
  air780TlsConfigurationAttempts++;
  Serial.print(F("Configuring Air780E HTTPS TLS context 153 (attempt "));
  Serial.print(air780TlsConfigurationAttempts);
  Serial.println(F(")."));

  // OpenLuat assigns SSL context 153 to the HTTP/HTTPS service. Air780EU V1180
  // in this installation returns +CME ERROR: 3 when HTTPSSL=1 is sent before
  // HTTPINIT, so beginAir780HttpsSession() initializes the HTTP service first.
  // TLS 1.2 plus all module-supported ciphers avoids a stale or overly narrow
  // persisted context. Prototype transport uses encryption without CA checking,
  // matching the Wi-Fi client's current setInsecure() behavior. Production
  // certificate verification requires installing a CA and seclevel 1.
  if (!enableAir780Https()) return false;
  if (!cellCommand("AT+SSLCFG=\"sslversion\",153,3", "OK", 3500)) return false;
  if (!cellCommand("AT+SSLCFG=\"ciphersuite\",153,0XFFFF", "OK", 3500)) return false;
  if (!cellCommand("AT+SSLCFG=\"seclevel\",153,0", "OK", 3500)) return false;
  if (!cellCommand("AT+SSLCFG=\"ignorelocaltime\",153,1", "OK", 3500)) return false;
  // Keep TLS negotiation below the complete 45-second modem HTTP deadline.
  if (!cellCommand("AT+SSLCFG=\"negotiatetimeout\",153,30", "OK", 3500)) return false;

  String hostnameCommand = "AT+SSLCFG=\"hostname\",153,\"" + String(API_HOST) + "\"";
  if (!cellCommand(hostnameCommand, "OK", 3500)) return false;

  air780TlsConfigured = true;
  Serial.println(F("Air780E HTTPS TLS context 153 configured for TLS 1.2."));
  return true;
}

bool restartAir780AfterHttpStall() {
  // Avoid a reset loop if the modem has a persistent firmware or hardware
  // fault. A successful HTTP action clears this guard for future recovery.
  if (air780HttpRecoveryCount >= 2) {
    Serial.println(F("Air780E HTTP recovery limit reached; power-cycle the modem and inspect its firmware if the fault persists."));
    return false;
  }
  air780HttpRecoveryCount++;
  Serial.println(F("Air780E HTTP service remained busy; restarting the modem before the next attempt."));
  // A functional reset is safer than repeatedly issuing HTTPINIT against an
  // active V1180 HTTP action. The next maintainCellular() pass will rebuild the
  // bearer and TLS context after the modem is responsive again.
  cellCommand("AT+CFUN=1,1", "OK", 7000, true);
  cellReady = false;
  air780TlsConfigured = false;
  air780TlsConfigurationAttempts = 0;
  lastCellAttemptMs = millis();
  return true;
}

bool endAir780HttpSession(bool restartIfBusy) {
  if (cellCommand("AT+HTTPTERM", "OK", 5000)) return true;
  if (restartIfBusy) restartAir780AfterHttpStall();
  return false;
}

bool beginAir780HttpsSession() {
  cellCommand("AT+HTTPTERM", "OK", 2500, true);
  delay(350);

  // V1180 requires an initialized HTTP service before it will accept or expose
  // the HTTPSSL state. This is also the order that V6.8.8 successfully used on
  // the physical Dallmayr controller.
  if (!cellCommand("AT+HTTPINIT", "OK", 3500)) {
    // +CME ERROR: 3 here means the prior HTTP service/action is still active.
    // Reboot the modem once instead of retrying HTTPINIT every 15 seconds.
    restartAir780AfterHttpStall();
    return false;
  }

  bool configuredTlsNow = !air780TlsConfigured;
  if (!configureAir780TlsContext()) {
    Serial.println(F("Air780E HTTPS TLS context configuration failed."));
    // If V1180 still rejects HTTPSSL or an SSLCFG command after HTTPINIT, reset
    // the separate modem here as well. Resetting the ESP32 alone does not clear
    // the Air780EU HTTP service.
    restartAir780AfterHttpStall();
    return false;
  }

  // SSLCFG is accepted only after HTTPINIT on the V1180 modem fitted to this
  // controller, but changing context 153 while the HTTP service is active can
  // leave HTTPPARA USER_DEFINED/USERDATA locked with +CME ERROR: 3. Apply the
  // context once, close that setup service, then open a clean request service.
  if (configuredTlsNow) {
    Serial.println(F("Reopening Air780E HTTP service after TLS context setup."));
    if (!endAir780HttpSession(true)) return false;
    delay(350);
    if (!cellCommand("AT+HTTPINIT", "OK", 3500)) {
      restartAir780AfterHttpStall();
      return false;
    }
    if (!enableAir780Https()) {
      Serial.println(F("Air780E HTTPS could not be restored after reopening HTTP."));
      endAir780HttpSession(true);
      return false;
    }
  }

  String sslState = cellQueryText("AT+HTTPSSL?", 3000);
  if (!air780HttpsStateIsEnabled(sslState)) {
    Serial.println(F("Air780E HTTPS unavailable. Modem firmware/status follows:"));
    Serial.println(cellQueryText("AT+CGMR", 4000));
    Serial.println(cellQueryText("AT+HTTPSSL=?", 3000));
    Serial.println(cellQueryText("AT+HTTPSSL?", 3000));
    cellCommand("AT+HTTPTERM", "OK", 2000, true);
    return false;
  }

  return true;
}

bool setAir780CompactHttpHeaders(bool withDeviceAuth) {
  // Supabase's legacy anon JWT is sufficient in Authorization for verify_jwt.
  // Do not duplicate the same JWT in an apikey header: that made the previous
  // USERDATA command exceed the Air780EU V1180 command parser's safe length.
  // OpenLuat documents literal \\r\\n separators for multiple USERDATA headers.
  String headers = "Authorization: Bearer " + supabaseAnonKey;
  if (withDeviceAuth) {
    if (!deviceEnrolled()) return false;
    headers += "\\r\\nX-Device-ID: " + deviceId
      + "\\r\\nX-Device-Key: " + deviceKey;
  }

  String command = "AT+HTTPPARA=\"USERDATA\",\"" + headers + "\"";
  if (command.length() > 480) {
    Serial.print(F("Air780E compact HTTP header command is still too long: "));
    Serial.println(command.length());
    return false;
  }

  Serial.print(F("Air780E compact HTTP header command length: "));
  Serial.println(command.length());
  return cellCommand(command, "OK", 3500);
}

bool readAir780StandardHttpAction(int& statusCode, int& dataLength,
                                      bool& bearerDeactivated, String& rawAction) {
  statusCode = 0;
  dataLength = 0;
  bearerDeactivated = false;
  rawAction = "";

  uint32_t started = millis();
  while (millis() - started < AIR780_HTTP_ACTION_WAIT_MS) {
    while (CellSerial.available()) {
      char c = static_cast<char>(CellSerial.read());
      rawAction += c;
      if (rawAction.length() > 12000) rawAction.remove(0, 3000);

      if (air780BearerWasDeactivated(rawAction)) bearerDeactivated = true;

      if (rawAction.indexOf("\r\nERROR\r\n") >= 0 ||
          rawAction.indexOf("+CME ERROR:") >= 0) {
        return false;
      }

      int actionPos = rawAction.lastIndexOf("+HTTPACTION:");
      if (actionPos < 0) continue;
      int lineEnd = rawAction.indexOf('\n', actionPos);
      if (lineEnd < 0) continue;

      String line = rawAction.substring(actionPos, lineEnd);
      line.trim();
      int firstComma = line.indexOf(',');
      int secondComma = firstComma >= 0 ? line.indexOf(',', firstComma + 1) : -1;
      if (firstComma < 0 || secondComma < 0) return false;

      statusCode = line.substring(firstComma + 1, secondComma).toInt();
      dataLength = line.substring(secondComma + 1).toInt();
      return statusCode > 0;
    }
    delay(2);
  }

  return false;
}

bool airHttpPost(const char* url, const String& json, String& responseBody, int& statusCode, bool withDeviceAuth = true) {
  responseBody = "";
  statusCode = 0;
  if (!cellReady) return false;
  if (!supabaseAnonKey.length()) {
    Serial.println(F("Supabase anon JWT missing. Use: SUPABASE ANON KEY <value>"));
    return false;
  }

  // OpenLuat documents a 3356-byte AT-firmware limit for HTTPDATA. Keep a small
  // safety margin; normal Dallmayr telemetry payloads are well below 1 KB.
  if (json.length() > 3300) {
    Serial.println(F("Payload too large for Air780EU standard HTTPDATA buffer."));
    return false;
  }

  if (!beginAir780HttpsSession()) return false;
  if (!cellCommand("AT+HTTPPARA=\"CID\",1", "OK", 2500)) {
    endAir780HttpSession(false);
    return false;
  }

  String urlCmd = "AT+HTTPPARA=\"URL\",\"" + String(url) + "\"";
  if (!cellCommand(urlCmd, "OK", 4000)) {
    endAir780HttpSession(false);
    return false;
  }
  if (!cellCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 2500)) {
    endAir780HttpSession(false);
    return false;
  }
  String timeoutCommand = "AT+HTTPPARA=\"TIMEOUT\"," + String(AIR780_HTTP_TIMEOUT_SECONDS);
  if (!cellCommand(timeoutCommand, "OK", 2500)) {
    endAir780HttpSession(false);
    return false;
  }
  if (!setAir780CompactHttpHeaders(withDeviceAuth)) {
    endAir780HttpSession(false);
    return false;
  }

  // V1180 on the deployed Air780EU accepts HTTPEXACTION but never emits the
  // +HTTPEXPOST data-request URC and never opens the extended POST prompt.
  // Use the standard, documented HTTPDATA -> HTTPACTION -> HTTPREAD sequence.
  Serial.print(F("Air780EU standard HTTP POST body length: "));
  Serial.println(json.length());

  cellDrain();
  CellSerial.print("AT+HTTPDATA=");
  CellSerial.print(json.length());
  CellSerial.print(',');
  CellSerial.print(AIR780_HTTP_POST_CHUNK_TIMEOUT_MS);
  CellSerial.print("\r\n");

  String dataPrompt = cellReadUntil(6000, "DOWNLOAD", "\r\nERROR\r\n",
                                    false, "+CME ERROR:");
  if (dataPrompt.indexOf("DOWNLOAD") < 0) {
    Serial.println(F("Air780EU standard HTTPDATA did not open the DOWNLOAD prompt."));
    if (dataPrompt.length()) {
      dataPrompt.replace("\r", " ");
      dataPrompt.replace("\n", " ");
      Serial.print(F("HTTPDATA modem response: "));
      Serial.println(dataPrompt);
    }
    endAir780HttpSession(true);
    return false;
  }

  CellSerial.print(json);
  String dataAccepted = cellReadUntil(AIR780_HTTP_POST_CHUNK_TIMEOUT_MS + 2500UL,
                                      "\r\nOK\r\n", "\r\nERROR\r\n",
                                      false, "+CME ERROR:");
  if (dataAccepted.indexOf("\r\nOK\r\n") < 0) {
    Serial.println(F("Air780EU did not accept the complete HTTPDATA payload."));
    endAir780HttpSession(true);
    return false;
  }

  cellDrain();
  CellSerial.print("AT+HTTPACTION=1\r\n");

  bool bearerDeactivated = false;
  int responseDataLength = 0;
  String rawAction;
  bool actionReceived = readAir780StandardHttpAction(
    statusCode, responseDataLength, bearerDeactivated, rawAction);

  if (!actionReceived) {
    Serial.print(F("No complete HTTPACTION result after "));
    Serial.print(AIR780_HTTP_TIMEOUT_SECONDS);
    Serial.println(F(" seconds."));
    if (rawAction.length()) {
      rawAction.replace("\r", " ");
      rawAction.replace("\n", " ");
      Serial.print(F("HTTPACTION modem response: "));
      Serial.println(rawAction);
    }
    if (bearerDeactivated) {
      Serial.println(F("Air780E bearer deactivated during HTTPACTION; cellular will reconnect."));
      cellReady = false;
    }
    endAir780HttpSession(true);
    return false;
  }

  Serial.print(F("Air780EU HTTPACTION status="));
  Serial.print(statusCode);
  Serial.print(F(" response_bytes="));
  Serial.println(responseDataLength);

  if (responseDataLength > 0) {
    cellDrain();
    CellSerial.print("AT+HTTPREAD\r\n");
    String read = cellReadUntil(10000, "\r\nOK\r\n", "\r\nERROR\r\n",
                                false, "+CME ERROR:");
    int header = read.indexOf("+HTTPREAD:");
    if (header >= 0) {
      int bodyStart = read.indexOf('\n', header);
      if (bodyStart >= 0) {
        bodyStart++;
        int bodyEnd = read.lastIndexOf("\r\nOK");
        if (bodyEnd < bodyStart) bodyEnd = read.length();
        responseBody = read.substring(bodyStart, bodyEnd);
        responseBody.trim();
      }
    }
  }

  recordApplicationTransfer("cellular", json.length(), responseBody.length());

  air780HttpRecoveryCount = 0;
  if (bearerDeactivated) {
    Serial.println(F("Air780E bearer deactivated after HTTPACTION; cellular will reconnect."));
    cellReady = false;
  }

  endAir780HttpSession(true);

  bool ok = statusCode >= 200 && statusCode < 300;
  if (!ok) {
    Serial.print(F("HTTP POST failed status="));
    Serial.println(statusCode);
    if (responseBody.length()) Serial.println(responseBody);

    if (statusCode == 408) {
      Serial.println(F("Air780EU HTTP service timed out before Supabase returned a response."));
    } else if (statusCode == 605) {
      if (air780TlsConfigurationAttempts < 2) {
        air780TlsConfigured = false;
        Serial.println(F("Air780E SSL channel establishment failed (605); TLS context 153 will be reapplied once."));
      } else {
        Serial.println(F("Air780EU still cannot negotiate TLS; modem AT firmware should be updated."));
      }
    }
  }

  if (withDeviceAuth && statusCode == 401) invalidateStaleDeviceCredential();
  return ok;
}

// -----------------------------------------------------------------------------
// GNSS / GPS (generic NMEA UART)
// -----------------------------------------------------------------------------

bool gnssChecksumValid(const String& sentence) {
  if (!sentence.startsWith("$") || sentence.length() < 7) return false;
  int star = sentence.indexOf('*');
  if (star < 0 || star + 2 >= (int)sentence.length()) return false;
  uint8_t checksum = 0;
  for (int i = 1; i < star; ++i) checksum ^= static_cast<uint8_t>(sentence[i]);
  char expected[3] = { sentence[star + 1], sentence[star + 2], 0 };
  return checksum == static_cast<uint8_t>(strtoul(expected, nullptr, 16));
}

int splitNmea(const String& sentence, String fields[], int maxFields) {
  int star = sentence.indexOf('*');
  String body = sentence.substring(1, star >= 0 ? star : sentence.length());
  int count = 0;
  int start = 0;
  while (count < maxFields) {
    int comma = body.indexOf(',', start);
    if (comma < 0) { fields[count++] = body.substring(start); break; }
    fields[count++] = body.substring(start, comma);
    start = comma + 1;
  }
  return count;
}

double nmeaCoordinate(const String& raw, const String& hemisphere) {
  if (!raw.length()) return NAN;
  double value = raw.toDouble();
  int degrees = static_cast<int>(value / 100.0);
  double minutes = value - degrees * 100.0;
  double decimal = degrees + minutes / 60.0;
  if (hemisphere == "S" || hemisphere == "W") decimal = -decimal;
  return decimal;
}

void updateGnssAccuracy() {
  if (!isnan(gnssFix.hdop) && gnssFix.hdop > 0) gnssFix.accuracyM = max(3.0f, gnssFix.hdop * 5.0f);
}

void parseNmeaSentence(const String& sentence) {
  if (!gnssChecksumValid(sentence)) return;
  String f[20];
  int count = splitNmea(sentence, f, 20);
  if (count < 2) return;

  if (f[0].endsWith("RMC") && count >= 10) {
    if (f[2] != "A") return;
    double lat = nmeaCoordinate(f[3], f[4]);
    double lon = nmeaCoordinate(f[5], f[6]);
    if (isnan(lat) || isnan(lon)) return;
    gnssFix.latitude = lat;
    gnssFix.longitude = lon;
    gnssFix.speedMps = f[7].length() ? static_cast<float>(f[7].toDouble() * 0.514444) : NAN;
    gnssFix.valid = true;
    gnssFix.lastFixMs = millis();
    if (f[1].length() >= 6 && f[9].length() == 6) {
      int day = f[9].substring(0, 2).toInt();
      int month = f[9].substring(2, 4).toInt();
      int year = 2000 + f[9].substring(4, 6).toInt();
      int hour = f[1].substring(0, 2).toInt();
      int minute = f[1].substring(2, 4).toInt();
      int second = f[1].substring(4, 6).toInt();
      snprintf(gnssFix.utcIso, sizeof(gnssFix.utcIso), "%04d-%02d-%02dT%02d:%02d:%02dZ", year, month, day, hour, minute, second);
    }
  }

  if (f[0].endsWith("GGA") && count >= 10) {
    if (f[6].toInt() <= 0) return;
    double lat = nmeaCoordinate(f[2], f[3]);
    double lon = nmeaCoordinate(f[4], f[5]);
    if (!isnan(lat) && !isnan(lon)) { gnssFix.latitude = lat; gnssFix.longitude = lon; }
    gnssFix.satellites = static_cast<uint8_t>(constrain(f[7].toInt(), 0, 99));
    gnssFix.hdop = f[8].length() ? static_cast<float>(f[8].toDouble()) : NAN;
    gnssFix.altitudeM = f[9].length() ? static_cast<float>(f[9].toDouble()) : NAN;
    gnssFix.valid = true;
    gnssFix.lastFixMs = millis();
    updateGnssAccuracy();
  }
}

void startGnss() {
#if !DALLMAYR_GNSS_ENABLED
  gnssSerial = nullptr;
  Serial.println(F("GNSS disabled; no optional receiver is fitted and the debug UART remains untouched."));
  return;
#else
  if (!DALLMAYR_MACHINE_IO_ENABLED || machineInterface != IFACE_DEX) {
    gnssSerial = &DexSerial;
  } else {
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
    gnssSerial = &GnssSerial0;
#else
    Serial.println(F("GNSS not started: DEX uses UART2 and UART0 is occupied by Serial. Enable USB CDC On Boot or use an external UART bridge."));
    return;
#endif
  }
  gnssSerial->begin(DALLMAYR_GNSS_BAUD, SERIAL_8N1, DALLMAYR_GNSS_RX_PIN, DALLMAYR_GNSS_TX_PIN);
  gnssLine.reserve(128);
  Serial.print(F("GNSS NMEA UART started RX GPIO")); Serial.print(DALLMAYR_GNSS_RX_PIN);
  Serial.print(F(" TX GPIO")); Serial.println(DALLMAYR_GNSS_TX_PIN);
#endif
}

void serviceGnss() {
  if (!gnssSerial) return;
  while (gnssSerial->available()) {
    char c = static_cast<char>(gnssSerial->read());
    if (c == '\n') {
      gnssLine.trim();
      if (gnssLine.length()) parseNmeaSentence(gnssLine);
      gnssLine = "";
    } else if (c != '\r') {
      if (gnssLine.length() < 160) gnssLine += c; else gnssLine = "";
    }
  }
  if (gnssFix.valid && millis() - gnssFix.lastFixMs > 600000UL) gnssFix.valid = false;
}

bool fallbackLocationConfigured() {
  return !(DALLMAYR_FALLBACK_LATITUDE == 0.0 && DALLMAYR_FALLBACK_LONGITUDE == 0.0)
    && DALLMAYR_FALLBACK_LATITUDE >= -90.0 && DALLMAYR_FALLBACK_LATITUDE <= 90.0
    && DALLMAYR_FALLBACK_LONGITUDE >= -180.0 && DALLMAYR_FALLBACK_LONGITUDE <= 180.0;
}

// -----------------------------------------------------------------------------
// Wi-Fi + cellular transport manager
// -----------------------------------------------------------------------------

bool wifiReady() {
  return WiFi.status() == WL_CONNECTED;
}

void maintainWiFi() {
  bool holdForConfigCommit = transportTransitionPending
    && strcmp(transportTransitionSource, "wifi") == 0
    && wifiReady();

  // A policy change is not allowed to tear down the connection that carried
  // the config until the ACK + commit heartbeat have completed.
  if (!policy.wifiEnabled && holdForConfigCommit) {
    return;
  }

  // Remote control can disable Wi-Fi per telemetry device.
  if (!policy.wifiEnabled || !wifiSsid.length()) {
    if (wifiBeginIssued && !wifiRadioDisabled) {
      Serial.println(F("Wi-Fi disabled by remote policy/config."));
      WiFi.setAutoReconnect(false);
      WiFi.disconnect(true, false);
      wifiBeginIssued = false;
      wifiRadioDisabled = true;
      wifiConnectionStartedMs = 0;
    }
    return;
  }

  if (wifiReady()) {
    wifiRadioDisabled = false;
    return;
  }

  // Configure/start the station only once. Repeating WiFi.begin() while the
  // ESP-IDF station is still associating causes:
  //   wifi:sta is connecting, cannot set config
  if (!wifiBeginIssued) {
    Serial.print(F("Starting Wi-Fi connection to SSID: "));
    Serial.println(wifiSsid);

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

    wifiBeginIssued = true;
    wifiRadioDisabled = false;
    lastWifiAttemptMs = millis();
    wifiConnectionStartedMs = lastWifiAttemptMs;
    return;
  }

  // ESP32 auto-reconnect owns subsequent retries. Do not call WiFi.begin()
  // again while a connection attempt may still be active.
  if (millis() - lastWifiAttemptMs >= WIFI_STATUS_LOG_MS) {
    lastWifiAttemptMs = millis();
    Serial.print(F("Wi-Fi not connected yet; auto-reconnect active. status="));
    Serial.println(static_cast<int>(WiFi.status()));
  }
}

bool gatewayCredentialReady(bool verbose = true) {
  bool ready = supabaseAnonKey.length() >= 20;
  if (!ready && verbose) {
    static uint32_t lastMissingGatewayLogMs = 0;
    uint32_t now = millis();
    if (lastMissingGatewayLogMs == 0 || now - lastMissingGatewayLogMs >= 30000UL) {
      lastMissingGatewayLogMs = now;
      Serial.println(F("Supabase gateway JWT missing; HTTPS upload blocked before TLS/HTTP."));
    }
  }
  return ready;
}

bool wifiHttpPost(const char* url, const String& json, String& responseBody, int& statusCode, bool withDeviceAuth = true) {
  responseBody = "";
  statusCode = 0;
  if (!wifiReady()) return false;
  if (!gatewayCredentialReady()) return false;

  Network.setDefaultInterface(WiFi.STA);
  WiFiClientSecure tls;
  // Prototype choice: encryption is enabled, but CA validation is not pinned.
  // Replace with a managed root CA bundle before fleet rollout.
  tls.setInsecure();

  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(20000);
  if (!http.begin(tls, url)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + supabaseAnonKey);
  http.addHeader("apikey", supabaseAnonKey);
  if (withDeviceAuth) {
    if (!deviceEnrolled()) {
      http.end();
      return false;
    }
    http.addHeader("X-Device-ID", deviceId);
    http.addHeader("X-Device-Key", deviceKey);
    http.addHeader("X-Firmware-Version", FIRMWARE_VERSION);
  }

  statusCode = http.POST(json);
  if (statusCode > 0) responseBody = http.getString();
  if (statusCode > 0) recordApplicationTransfer("wifi", json.length(), responseBody.length());
  http.end();

  if (withDeviceAuth && statusCode == 401) invalidateStaleDeviceCredential();
  return statusCode >= 200 && statusCode < 300;
}

bool pppHttpPost(const char* url, const String& json, String& responseBody,
                 int& statusCode, bool withDeviceAuth = true) {
  responseBody = "";
  statusCode = 0;
  if (!pppOnline || !airPppHasIp()) return false;
  if (!gatewayCredentialReady()) return false;

  if (!selectAirPppAsDefault()) return false;

  NetworkClientSecure tls;
  // Same commissioning posture as Wi-Fi: encrypted TLS with CA verification
  // disabled until the production CA bundle is pinned.
  tls.setInsecure();

  HTTPClient http;
  http.setConnectTimeout(15000);
  http.setTimeout(30000);
  if (!http.begin(tls, url)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + supabaseAnonKey);
  http.addHeader("apikey", supabaseAnonKey);
  if (withDeviceAuth) {
    if (!deviceEnrolled()) {
      http.end();
      return false;
    }
    http.addHeader("X-Device-ID", deviceId);
    http.addHeader("X-Device-Key", deviceKey);
    http.addHeader("X-Firmware-Version", FIRMWARE_VERSION);
  }

  statusCode = http.POST(json);
  if (statusCode > 0) responseBody = http.getString();
  if (statusCode > 0) recordApplicationTransfer("cellular", json.length(), responseBody.length());
  http.end();

  if (statusCode <= 0) {
    Serial.print(F("ESP32 PPP HTTPS POST failed before HTTP response, code="));
    Serial.print(statusCode);
    if (statusCode < 0) {
      Serial.print(F(" error="));
      Serial.println(HTTPClient::errorToString(statusCode));
    } else {
      Serial.println();
    }
  }
  if (withDeviceAuth && statusCode == 401) invalidateStaleDeviceCredential();
  return statusCode >= 200 && statusCode < 300;
}

void addTransportMetadata(JsonDocument& doc, const char* transport) {
  doc["transport"] = transport;
  doc["wifi_rssi"] = wifiReady() ? WiFi.RSSI() : 0;
  doc["cellular_csq"] = cellularCsq;
  doc["cellular_link"] = pppOnline ? "ppp" : "at";
  if (cellularModel.length()) doc["cellular_model"] = cellularModel;
  if (cellularOperator.length()) doc["cellular_operator"] = cellularOperator;
}

void addDataUsageMetadata(JsonDocument& doc, const char* transport) {
  JsonObject usage = doc["data_usage"].to<JsonObject>();
  String transportEpoch = String(dataUsageEpoch) + "-" + transport;
  usage["counter_epoch"] = transportEpoch;
  usage["sample_uptime_ms"] = millis();
  if (strcmp(transport, "cellular") == 0) {
    // A heartbeat refreshes this immediately before upload. Other telemetry
    // reuses that fresh sample for up to five seconds to avoid two back-to-back
    // AT^DATAINFO requests during the same transmission.
    if (!pppStarted && cellModemRegistered && (lastCellularModemUsageSampleMs == 0 ||
        millis() - lastCellularModemUsageSampleMs > 5000UL)) {
      readCellModemDataUsage(false);
    }
    usage["application_tx_bytes_total"] = cellularApplicationTxBytes;
    usage["application_rx_bytes_total"] = cellularApplicationRxBytes;
    usage["application_bytes_total"] = cellularApplicationTxBytes + cellularApplicationRxBytes;
    if (cellularModemUsageAvailable) {
      usage["modem_tx_bytes_total"] = cellularModemTxBytes;
      usage["modem_rx_bytes_total"] = cellularModemRxBytes;
      usage["modem_bytes_total"] = cellularModemTxBytes + cellularModemRxBytes;
    }
  } else if (strcmp(transport, "wifi") == 0) {
    usage["application_tx_bytes_total"] = wifiApplicationTxBytes;
    usage["application_rx_bytes_total"] = wifiApplicationRxBytes;
    usage["application_bytes_total"] = wifiApplicationTxBytes + wifiApplicationRxBytes;
  }
}

bool tryRawPost(const char* transport, const char* url, const String& json,
                String& responseBody, int& statusCode) {
  if (strcmp(transport, "wifi") == 0) {
    if (!wifiReady()) return false;
    return wifiHttpPost(url, json, responseBody, statusCode);
  }
  if (strcmp(transport, "cellular") == 0) {
    if (!pppOnline || !airPppHasIp()) return false;
    return pppHttpPost(url, json, responseBody, statusCode);
  }
  return false;
}

bool transportAllowed(const char* transport) {
  if (strcmp(transport, "wifi") == 0) return policy.wifiEnabled;
  if (strcmp(transport, "cellular") == 0) return policy.cellularEnabled;
  return false;
}

void getTransportOrder(const char*& first, const char*& second) {
  String pref = policy.transportPreference;
  pref.toLowerCase();
  if (pref == "cellular") {
    first = "cellular";
    second = "wifi";
  } else {
    // "wifi" and "auto" both prefer Wi-Fi to reduce SIM data usage.
    first = "wifi";
    second = "cellular";
  }
}

bool postRawWithFailover(const char* url, const String& json, String& responseBody,
                         int& statusCode, String& usedTransport, bool managementTraffic) {
  const char* first;
  const char* second;
  getTransportOrder(first, second);

  const char* attempts[2] = { first, second };
  for (uint8_t i = 0; i < 2; ++i) {
    const char* t = attempts[i];
    if (!managementTraffic && !transportAllowed(t)) continue;
    if (tryRawPost(t, url, json, responseBody, statusCode)) {
      usedTransport = t;
      return true;
    }
  }

  // Management/config traffic is deliberately allowed to use either physical
  // connection. This prevents a bad remote transport setting from permanently
  // locking the device out of its control plane.
  if (managementTraffic) {
    const char* recovery[2] = { "wifi", "cellular" };
    for (uint8_t i = 0; i < 2; ++i) {
      const char* t = recovery[i];
      if (String(t) == first || String(t) == second) continue;
      if (tryRawPost(t, url, json, responseBody, statusCode)) {
        usedTransport = t;
        return true;
      }
    }
  }

  return false;
}

bool anyDataTransportReady() {
  return (policy.wifiEnabled && wifiReady()) || (policy.cellularEnabled && pppOnline && airPppHasIp());
}

// -----------------------------------------------------------------------------
// First-boot enrollment
// -----------------------------------------------------------------------------

bool enrollOverAvailableNetwork(String& responseBody, int& statusCode, String& usedTransport) {
  responseBody = "";
  statusCode = 0;

  JsonDocument doc;
  // An empty token requests the secure administrator-controlled enrollment
  // window. A stored token selects the legacy one-time-token fallback.
  if (enrollmentToken.length()) doc["enrollment_token"] = enrollmentToken;
  doc["hardware_uid"] = hardwareUid;
  doc["firmware"] = FIRMWARE_VERSION;
  if (reportedMachineSerial.length()) doc["machine_serial"] = reportedMachineSerial;

  String payload;
  serializeJson(doc, payload);

  if (DALLMAYR_ZERO_TOUCH_CELL_FIRST
      && pppOnline && pppHttpPost(ENROLL_URL, payload, responseBody, statusCode, false)) {
    usedTransport = "cellular";
    return true;
  }
  if (wifiReady() && wifiHttpPost(ENROLL_URL, payload, responseBody, statusCode, false)) {
    usedTransport = "wifi";
    return true;
  }
  if (!DALLMAYR_ZERO_TOUCH_CELL_FIRST
      && pppOnline && pppHttpPost(ENROLL_URL, payload, responseBody, statusCode, false)) {
    usedTransport = "cellular";
    return true;
  }
  return false;
}

bool performEnrollment() {
  if (deviceEnrolled()) return true;
  if (!hardwareUid.length()) return false;
  if (!wifiReady() && !pppOnline) return false;

  Serial.print(F("Automatic enrollment attempt method="));
  Serial.print(enrollmentToken.length() ? "one_time_token" : "administrator_window");
  Serial.print(F(" device="));
  Serial.println(deviceId);
  String body;
  String usedTransport;
  int status = 0;
  if (!enrollOverAvailableNetwork(body, status, usedTransport)) {
    Serial.print(F("Enrollment failed HTTP="));
    Serial.println(status);
    if (body.length()) Serial.println(body);
    if (status == 403 && !enrollmentToken.length()) {
      Serial.println(F("Waiting for an Administrator to select 'Allow next device' in DallmayrERP."));
    } else if (status == 409) {
      Serial.println(F("This hardware UID already exists. Recommission it from DallmayrERP if NVS was erased."));
    }
    return false;
  }

  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    Serial.println(F("Enrollment response was not valid JSON."));
    return false;
  }
  if (!doc["accepted"].as<bool>()) {
    Serial.println(F("Enrollment was not accepted."));
    return false;
  }

  String returnedCode = doc["device_code"] | "";
  String returnedKey = doc["device_key"] | "";
  if (returnedCode != deviceId || returnedKey.length() < 20) {
    Serial.println(F("Enrollment response identity mismatch."));
    return false;
  }

  deviceKey = returnedKey;
  saveDeviceCredential();
  enrollmentToken = "";
  saveEnrollmentToken();

  Serial.print(F("ENROLLED via "));
  Serial.println(usedTransport);
  Serial.print(F("Enrollment method: "));
  Serial.println(String(doc["enrollment_method"] | (enrollmentToken.length() ? "one_time_token" : "automatic_window")));
  Serial.print(F("Device ID: "));
  Serial.println(deviceId);
  Serial.print(F("Machine link: "));
  Serial.println(String(doc["machine_link_status"] | "unlinked"));
  if (!doc["machine_id"].isNull()) {
    Serial.print(F("Machine UUID: "));
    Serial.println(String(doc["machine_id"] | ""));
  }
  heartbeatUploadRequested = true;
  lastConfigSuccessMs = 0;
  return true;
}

void maintainEnrollment() {
  if (deviceEnrolled()) return;
  if (millis() - lastEnrollmentAttemptMs < ENROLL_RETRY_MS && lastEnrollmentAttemptMs != 0) return;
  lastEnrollmentAttemptMs = millis();
  performEnrollment();
}

// -----------------------------------------------------------------------------
// Supabase payloads
// -----------------------------------------------------------------------------

void addCommonPayload(JsonDocument& doc, const char* type) {
  doc["type"] = type;
  doc["device_id"] = deviceId;
  doc["hardware_uid"] = hardwareUid;
  if (reportedMachineSerial.length()) doc["machine_serial"] = reportedMachineSerial;
  doc["boot_id"] = bootId;
  doc["sequence"] = ++sequenceNumber;
  doc["firmware"] = FIRMWARE_VERSION;
  doc["machine_interface"] = interfaceName(machineInterface);
  doc["profile_id"] = policy.profileId;

  if (reportedMachineSerial.length() || reportedMachineModel.length()
      || machineIdentitySource.length() || machineProfileFingerprint.length()) {
    JsonObject identity = doc["machine_identity"].to<JsonObject>();
    if (machineIdentitySource.length()) identity["source"] = machineIdentitySource;
    if (reportedMachineSerial.length()) identity["serial"] = reportedMachineSerial;
    if (reportedMachineModel.length()) identity["model"] = reportedMachineModel;
    if (reportedMachineRevision.length()) identity["revision"] = reportedMachineRevision;
    if (reportedMachineLocation.length()) identity["location"] = reportedMachineLocation;
    if (reportedMachineAsset.length()) identity["asset"] = reportedMachineAsset;
    if (machineProfileFingerprint.length()) identity["profile_fingerprint"] = machineProfileFingerprint;
    identity["auto_profile_evidence"] = true;
  }
}

void addPrepaidBalanceMetadata(JsonDocument& doc) {
  JsonObject balance = doc["prepaid_balance"].to<JsonObject>();
  balance["carrier"] = "Vodacom South Africa";
  balance["ussd_code"] = strlen(policy.prepaidBalanceUssdCode)
    ? policy.prepaidBalanceUssdCode : DEFAULT_PREPAID_BALANCE_USSD;
  balance["status"] = prepaidBalanceStatus;
  balance["available"] = prepaidBalanceAvailable;
  balance["report_pending"] = prepaidBalanceReportPending;
  if (prepaidBalanceAvailable) balance["remaining_bytes"] = prepaidBalanceRemainingBytes;
  if (prepaidBalanceText.length()) balance["balance_text"] = prepaidBalanceText;
  if (prepaidBalanceError.length()) balance["error"] = prepaidBalanceError;
  if (lastPrepaidBalanceCheckMs != 0) balance["checked_uptime_ms"] = lastPrepaidBalanceCheckMs;
}

bool sendDocumentToIngest(JsonDocument& doc) {
  if (!deviceEnrolled()) return false;
  const char* first;
  const char* second;
  getTransportOrder(first, second);
  const char* attempts[2] = { first, second };

  for (uint8_t i = 0; i < 2; ++i) {
    const char* t = attempts[i];
    if (!transportAllowed(t)) continue;
    if (strcmp(t, "wifi") == 0 && !wifiReady()) continue;
    if (strcmp(t, "cellular") == 0 && (!pppOnline || !airPppHasIp())) continue;

    addTransportMetadata(doc, t);
    addDataUsageMetadata(doc, t);
    String payload;
    serializeJson(doc, payload);
    String body;
    int status = 0;

    bool ok = strcmp(t, "wifi") == 0
      ? wifiHttpPost(INGEST_URL, payload, body, status)
      : pppHttpPost(INGEST_URL, payload, body, status);

    if (ok) {
      Serial.print(F("Telemetry uploaded via "));
      Serial.println(t);
      return true;
    }

    Serial.print(F("Telemetry upload failed via "));
    Serial.print(t);
    Serial.print(F(" HTTP="));
    Serial.println(status);
  }

  return false;
}

bool sendDocumentToIngestViaTransport(JsonDocument& doc, const char* transport) {
  if (!deviceEnrolled() || !transport) return false;

  bool isWifi = strcmp(transport, "wifi") == 0;
  bool isCellular = strcmp(transport, "cellular") == 0;
  if (!isWifi && !isCellular) return false;
  if (isWifi && !wifiReady()) return false;
  if (isCellular && (!pppOnline || !airPppHasIp())) return false;

  addTransportMetadata(doc, transport);
  addDataUsageMetadata(doc, transport);

  String payload;
  serializeJson(doc, payload);
  String body;
  int status = 0;
  bool ok = isWifi
    ? wifiHttpPost(INGEST_URL, payload, body, status)
    : pppHttpPost(INGEST_URL, payload, body, status);

  if (ok) {
    Serial.print(F("Telemetry uploaded via forced config-commit transport "));
    Serial.println(transport);
    return true;
  }

  Serial.print(F("Forced config-commit telemetry failed via "));
  Serial.print(transport);
  Serial.print(F(" HTTP="));
  Serial.println(status);
  return false;
}

bool uploadHeartbeatViaTransport(const char* transport) {
  bool modemSampleFresh = false;
  if (transport && strcmp(transport, "cellular") == 0 && cellModemRegistered && !pppStarted) {
    modemSampleFresh = readCellModemDataUsage(false);
  }

  JsonDocument doc;
  addCommonPayload(doc, "heartbeat");
  addPrepaidBalanceMetadata(doc);
  doc["data_usage_requested"] = true;
  doc["cellular_modem_usage_available"] = cellularModemUsageAvailable;
  doc["cellular_modem_sample_fresh"] = modemSampleFresh;
  doc["config_commit"] = true;

  bool ok = sendDocumentToIngestViaTransport(doc, transport);
  if (ok) {
    prepaidBalanceReportPending = false;
    heartbeatUploadRequested = false;
    lastHeartbeatUploadSuccessMs = millis();
    saveDataUsageNow();
    Serial.println(F("Config-commit heartbeat accepted."));
  }
  return ok;
}

bool uploadHeartbeat() {
  // Refresh the Air780E carrier counters before every pulse check. The normal
  // data_usage object is then attached by sendDocumentToIngest() for whichever
  // transport actually carries the heartbeat. Supabase also measures the exact
  // request and response byte lengths for this individual heartbeat.
  bool modemSampleFresh = false;
  if (cellModemRegistered && !pppStarted) modemSampleFresh = readCellModemDataUsage(false);

  JsonDocument doc;
  addCommonPayload(doc, "heartbeat");
  addPrepaidBalanceMetadata(doc);
  doc["data_usage_requested"] = true;
  doc["cellular_modem_usage_available"] = cellularModemUsageAvailable;
  doc["cellular_modem_sample_fresh"] = modemSampleFresh;
  bool ok = sendDocumentToIngest(doc);
  if (ok) {
    prepaidBalanceReportPending = false;
    heartbeatUploadRequested = false;
    lastHeartbeatUploadSuccessMs = millis();
    // The HTTP request/response counters are incremented during transmission.
    // Persist those new totals immediately instead of waiting for the normal
    // five-minute NVS debounce window.
    saveDataUsageNow();
    Serial.println(F("Heartbeat pulse accepted with current data-usage totals."));
  }
  return ok;
}

bool uploadFaultState(const String& code, bool active, const String& severity,
                      const String& source, const String& detail, const String& raw) {
  JsonDocument doc;
  addCommonPayload(doc, "fault_state");
  doc["fault_code"] = code;
  doc["active"] = active;
  doc["severity"] = severity;
  doc["source"] = source;
  doc["detail"] = detail;
  if (raw.length()) doc["raw"] = raw.substring(0, 480);
  return sendDocumentToIngest(doc);
}

bool uploadCounterBatch(uint16_t startIndex, uint16_t& nextIndex) {
  JsonDocument doc;
  addCommonPayload(doc, "counter_snapshot");
  doc["counter_epoch"] = counterEpoch;
  doc["reporting_mode"] = policy.mode;
  doc["counter_semantics"] = "cumulative_successful_completed_vends_per_selection";
  JsonArray items = doc["items"].to<JsonArray>();

  uint8_t added = 0;
  uint16_t i = startIndex;
  for (; i < counterCount && added < MAX_ITEMS_PER_UPLOAD; ++i) {
    CounterEntry& c = counters[i];
    if (!c.used) continue;
    JsonObject item = items.add<JsonObject>();
    item["selection"] = c.selection;
    if (strlen(c.product)) item["product"] = c.product;
    if (c.priceCents > 0) item["configured_price_cents"] = c.priceCents;
    item["sold_total"] = c.soldTotal;
    item["cup_count_total"] = c.soldTotal;
    item["failed_total"] = c.failedTotal;
    item["revenue_cents_total"] = c.revenueCentsTotal;
    added++;
  }
  nextIndex = i;
  if (added == 0) return true;

  bool ok = sendDocumentToIngest(doc);
  if (ok) {
    for (uint16_t j = startIndex; j < nextIndex; ++j) {
      if (j < counterCount && counters[j].used) counters[j].dirty = false;
    }
  }
  return ok;
}

bool uploadAllCounters() {
  if (!anyDataTransportReady()) return false;
  uint16_t index = 0;
  while (index < counterCount) {
    uint16_t next = index;
    if (!uploadCounterBatch(index, next)) return false;
    if (next <= index) break;
    index = next;
  }
  counterUploadRequested = false;
  policy.counterDue = false;
  lastCounterUploadSuccessMs = millis();
  counterScheduleStartMs = lastCounterUploadSuccessMs;
  return true;
}

bool sendCellularSimulationSnapshot(const char* testBootId, uint64_t soldTotal,
                                    uint64_t revenueCentsTotal, JsonDocument& responseDoc,
                                    size_t& requestBytes, size_t& responseBytes) {
  JsonDocument doc;
  addCommonPayload(doc, "simulation_snapshot");
  doc["schema"] = 3;
  doc["simulation"] = true;
  doc["test_mode"] = "automatic_power_on";
  doc["boot_id"] = testBootId;
  doc["counter_epoch"] = String("SIM-") + hardwareUid;
  doc["machine_status"] = "online";
  doc["active_fault_count"] = 0;
  doc["telemetry_source"] = "database_field_test";
  addTransportMetadata(doc, "cellular");
  addDataUsageMetadata(doc, "cellular");

  JsonArray items = doc["items"].to<JsonArray>();
  JsonObject item = items.add<JsonObject>();
  item["selection"] = "TEST-A1";
  item["product"] = "Automatic telemetry test product";
  item["configured_price_cents"] = 1500;
  item["sold_total"] = soldTotal;
  item["failed_total"] = 0;
  item["revenue_cents_total"] = revenueCentsTotal;

  String payload;
  serializeJson(doc, payload);
  String body;
  int status = 0;
  bool ok = pppHttpPost(INGEST_URL, payload, body, status);
  requestBytes = payload.length();
  responseBytes = body.length();

  Serial.print(F("SIM DATA TEST HTTP="));
  Serial.print(status);
  Serial.print(F(" request="));
  Serial.print(requestBytes);
  Serial.print(F("B response="));
  Serial.print(responseBytes);
  Serial.println(F("B"));

  if (!ok) {
    if (body.length()) Serial.println(body);
    return false;
  }
  DeserializationError error = deserializeJson(responseDoc, body);
  if (error || !responseDoc["accepted"].as<bool>() || !responseDoc["simulation"].as<bool>()) {
    Serial.println(F("SIM DATA TEST response was not an accepted simulation upload."));
    if (body.length()) Serial.println(body);
    return false;
  }
  return true;
}

bool runVodacomSimDataTest() {
  Serial.println(F("--- VODACOM CELLULAR-ONLY SIM DATA TEST ---"));
  if (!DALLMAYR_SIM_DATA_TEST_ENABLED) {
    Serial.println(F("Blocked: this firmware was not compiled as a simulation-test build."));
    return false;
  }
  if (!deviceEnrolled()) {
    Serial.println(F("Blocked: enroll the device before running the test."));
    return false;
  }
  if (!pppOnline) {
    Serial.println(F("Cellular manual PPP is not ready; attempting to connect now."));
    ensureCellularPpp();
  }
  if (!pppOnline || !airPppHasIp()) {
    Serial.println(F("Blocked: the Air780EU could not establish PPP cellular IP."));
    return false;
  }

  // UART1 is in PPP data mode during this test, so modem-side AT^DATAINFO
  // counters are unavailable. Application request/response counters remain
  // authoritative for DallmayrERP's per-device usage display.
  bool modemUsageAtStart = false;
  uint64_t modemTxBefore = cellularModemTxBytes;
  uint64_t modemRxBefore = cellularModemRxBytes;

  char testBootId[33] = {0};
  makeRandomId(testBootId, sizeof(testBootId));
  uint64_t applicationTxBefore = cellularApplicationTxBytes;
  uint64_t applicationRxBefore = cellularApplicationRxBytes;
  size_t requestBytes = 0;
  size_t responseBytes = 0;
  JsonDocument baselineResponse;
  if (!sendCellularSimulationSnapshot(testBootId, 0, 0, baselineResponse, requestBytes, responseBytes)) {
    Serial.println(F("SIM DATA TEST FAILED during the zero-value baseline."));
    return false;
  }

  delay(500);
  JsonDocument incrementResponse;
  if (!sendCellularSimulationSnapshot(testBootId, 1, 1500, incrementResponse, requestBytes, responseBytes)) {
    Serial.println(F("SIM DATA TEST FAILED during the one-item increment."));
    return false;
  }

  long dailyUnits = incrementResponse["daily_delta_units"] | -1;
  long dailyRevenue = incrementResponse["daily_delta_revenue_cents"] | -1;
  if (dailyUnits != 1 || dailyRevenue != 1500) {
    Serial.print(F("SIM DATA TEST FAILED: expected delta 1 / R15.00, received "));
    Serial.print(dailyUnits);
    Serial.print(F(" / cents "));
    Serial.println(dailyRevenue);
    return false;
  }

  // Refresh the modem counters, then send the same cumulative snapshot once
  // more. Its delta is zero, but it reports the usage totals from both test
  // uploads to DallmayrERP over cellular. The backend also independently
  // counts all three HTTP request/response bodies.
  readCellModemDataUsage(false);
  JsonDocument usageReportResponse;
  if (!sendCellularSimulationSnapshot(testBootId, 1, 1500, usageReportResponse, requestBytes, responseBytes)) {
    Serial.println(F("SIM DATA TEST FAILED while reporting final data usage."));
    return false;
  }
  long usageReportUnits = usageReportResponse["daily_delta_units"] | -1;
  long usageReportRevenue = usageReportResponse["daily_delta_revenue_cents"] | -1;
  if (usageReportUnits != 0 || usageReportRevenue != 0) {
    Serial.println(F("SIM DATA TEST FAILED: final usage snapshot was not idempotent."));
    return false;
  }

  bool modemUsageAtEnd = readCellModemDataUsage(false);
  saveDataUsageNow();
  saveAutomaticSimulationTestCompleted(true);
  lastSimulationUploadMs = millis();

  uint64_t applicationTxDelta = cellularApplicationTxBytes >= applicationTxBefore
    ? cellularApplicationTxBytes - applicationTxBefore : 0;
  uint64_t applicationRxDelta = cellularApplicationRxBytes >= applicationRxBefore
    ? cellularApplicationRxBytes - applicationRxBefore : 0;
  char byteBuffer[24] = {0};
  Serial.println(F("SIM DATA TEST PASSED: DallmayrERP accepted the cellular-only dummy telemetry."));
  snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(applicationTxDelta));
  Serial.print(F("Test application TX JSON bytes: ")); Serial.print(byteBuffer); Serial.println(F(" B"));
  snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(applicationRxDelta));
  Serial.print(F("Test application RX JSON bytes: ")); Serial.print(byteBuffer); Serial.println(F(" B"));
  if (modemUsageAtStart && modemUsageAtEnd
      && cellularModemTxBytes >= modemTxBefore && cellularModemRxBytes >= modemRxBefore) {
    uint64_t modemTxDelta = cellularModemTxBytes - modemTxBefore;
    uint64_t modemRxDelta = cellularModemRxBytes - modemRxBefore;
    snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(modemTxDelta));
    Serial.print(F("Test Air780E network TX bytes: ")); Serial.print(byteBuffer); Serial.println(F(" B"));
    snprintf(byteBuffer, sizeof(byteBuffer), "%llu", static_cast<unsigned long long>(modemRxDelta));
    Serial.print(F("Test Air780E network RX bytes: ")); Serial.print(byteBuffer); Serial.println(F(" B"));
    if (modemTxDelta == 0 && modemRxDelta == 0) {
      Serial.println(F("WARNING: modem counters did not move; wait 30 seconds and run SIM DATA TEST again."));
    }
  } else {
    Serial.println(F("Air780E network byte delta unavailable; DallmayrERP HTTP acceptance still proves cellular transfer."));
  }
  Serial.println(F("Vodacom's portal remains authoritative because carrier accounting can include additional overhead."));
  return true;
}

void serviceAutomaticSimDataTest() {
  if (!DALLMAYR_SIM_DATA_TEST_ENABLED || !DALLMAYR_SIM_DATA_TEST_AUTO_RUN) return;
  if (automaticSimulationTestCompleted) return;
  if (!deviceEnrolled() || !cellReady) return;
  if (lastSimulationUploadMs != 0
      && millis() - lastSimulationUploadMs < AUTOMATIC_SIM_TEST_RETRY_MS) return;
  lastSimulationUploadMs = millis();
  Serial.println(F("Starting automatic cellular database-field test..."));
  if (!runVodacomSimDataTest()) {
    Serial.println(F("Automatic test did not pass; firmware will retry without user input."));
  }
}

bool uploadConfigAck() {
  if (!deviceEnrolled()) return false;
  if (!wifiReady() && !cellReady) return false;

  JsonDocument doc;
  addCommonPayload(doc, "config_ack");
  JsonObject applied = doc["applied_config"].to<JsonObject>();
  applied["policy_code"] = policy.policyCode;
  applied["policy_source"] = policy.source;
  if (strlen(policy.policyUpdatedAt)) applied["policy_updated_at"] = policy.policyUpdatedAt;
  applied["mode"] = policy.mode;
  applied["counter_interval_minutes"] = policy.counterIntervalMinutes;
  applied["heartbeat_interval_minutes"] = policy.heartbeatIntervalMinutes;
  applied["config_refresh_minutes"] = policy.configRefreshMinutes;
  applied["fault_reporting_immediate"] = policy.immediateFaults;
  applied["recovery_reporting_immediate"] = policy.immediateRecovery;
  applied["profile_id"] = policy.profileId;
  applied["transport_preference"] = policy.transportPreference;
  applied["wifi_enabled"] = policy.wifiEnabled;
  applied["cellular_enabled"] = policy.cellularEnabled;
  applied["location_enabled"] = policy.locationEnabled;
  applied["location_interval_minutes"] = policy.locationIntervalMinutes;
  applied["location_min_move_m"] = policy.locationMinMoveM;

  String payload;
  serializeJson(doc, payload);
  String responseBody;
  String usedTransport;
  int status = 0;

  // Config acknowledgement is control-plane traffic. It may use either
  // physically available transport even if the newly-applied policy disables
  // that transport, preventing a remote setting from hiding its own ACK.
  bool ok = postRawWithFailover(
    INGEST_URL, payload, responseBody, status, usedTransport, true
  );
  if (!ok) {
    Serial.print(F("Config ACK failed HTTP="));
    Serial.println(status);
    return false;
  }

  JsonDocument response;
  DeserializationError err = deserializeJson(response, responseBody);
  if (!err && response["accepted"].is<bool>() && !response["accepted"].as<bool>()) {
    Serial.println(F("Config ACK was not accepted by Supabase."));
    return false;
  }

  configAckPending = false;
  // Every applied configuration is followed by a heartbeat. If the config
  // disables the current transport, serviceTransportTransitionCommit() sends
  // that pulse over the proven config transport before it is released.
  heartbeatUploadRequested = true;
  saveDataUsageNow();
  Serial.print(F("Applied DB configuration acknowledged via "));
  Serial.println(usedTransport);
  return true;
}

void serviceConfigAck() {
  if (!configAckPending || !deviceEnrolled()) return;
  if (!wifiReady() && !cellReady) return;
  uint32_t now = millis();
  if (lastConfigAckAttemptMs != 0 &&
      now - lastConfigAckAttemptMs < CONFIG_ACK_RETRY_MS) return;
  lastConfigAckAttemptMs = now;
  uploadConfigAck();
}

void serviceTransportTransitionCommit() {
  if (!transportTransitionPending) return;
  if (configAckPending) return;

  uint32_t now = millis();
  if (lastTransportTransitionAttemptMs != 0
      && now - lastTransportTransitionAttemptMs < TRANSPORT_COMMIT_RETRY_MS) return;
  lastTransportTransitionAttemptMs = now;

  Serial.print(F("Committing transport change with final heartbeat over "));
  Serial.println(transportTransitionSource);

  if (!uploadHeartbeatViaTransport(transportTransitionSource)) {
    Serial.println(F("Transport change commit heartbeat failed; keeping the proven transport alive and retrying."));
    return;
  }

  transportTransitionPending = false;
  transportTransitionSource[0] = '\0';
  lastTransportTransitionAttemptMs = 0;
  Serial.println(F("Transport change committed. New DB transport policy may now take effect."));
}

void remoteDebugFinalizeLine() {
  if (remoteDebugCurrentLength == 0) return;

  uint16_t index;
  if (remoteDebugCount >= REMOTE_DEBUG_RING_LINES) {
    remoteDebugHead = static_cast<uint16_t>((remoteDebugHead + 1) % REMOTE_DEBUG_RING_LINES);
    remoteDebugCount--;
    remoteDebugDroppedLines++;
  }
  index = static_cast<uint16_t>((remoteDebugHead + remoteDebugCount) % REMOTE_DEBUG_RING_LINES);

  RemoteDebugLine& line = remoteDebugRing[index];
  line.sequence = ++remoteDebugSequence;
  line.uptimeMs = millis();
  memcpy(line.message, remoteDebugCurrentLine, remoteDebugCurrentLength);
  line.message[remoteDebugCurrentLength] = '\0';
  remoteDebugCount++;

  remoteDebugCurrentLength = 0;
  remoteDebugCurrentLine[0] = '\0';
}

void remoteDebugCaptureByte(uint8_t value) {
  if (remoteDebugCaptureSuppressed) return;
  if (value == '\r') return;
  if (value == '\n') {
    remoteDebugFinalizeLine();
    return;
  }

  if (value == '\t' || (value >= 0x20 && value <= 0x7E)) {
    if (remoteDebugCurrentLength < REMOTE_DEBUG_LINE_BYTES - 1) {
      remoteDebugCurrentLine[remoteDebugCurrentLength++] = static_cast<char>(value);
      remoteDebugCurrentLine[remoteDebugCurrentLength] = '\0';
    }
  }
}

bool remoteDebugCommandAlreadyQueued(const String& id) {
  for (uint8_t i = 0; i < remoteDebugCompletedCommandCount; ++i) {
    if (id == remoteDebugCompletedCommandIds[i]) return true;
  }
  return false;
}

bool remoteDebugCommandAllowed(String command) {
  command.trim();
  command.toUpperCase();
  return command == "STATUS"
      || command == "MACHINE IDENTITY"
      || command == "CUP COUNTERS"
      || command == "DATA USAGE"
      || command == "CELL PPP STATUS"
      || command == "WIRING"
      || command == "HELP";
}

void executeRemoteDebugCommand(const String& id, String command) {
  if (!remoteDebugActive || !id.length() || remoteDebugCommandAlreadyQueued(id)) return;
  command.trim();
  command.toUpperCase();

  if (!remoteDebugCommandAllowed(command)) {
    Serial.print(F("[TEST CENTER] blocked remote command: "));
    Serial.println(command);
    return;
  }

  Serial.print(F("[TEST CENTER COMMAND] "));
  Serial.println(command);
  handleConsoleLine(command);

  if (remoteDebugCompletedCommandCount < 8) {
    copyText(remoteDebugCompletedCommandIds[remoteDebugCompletedCommandCount],
             sizeof(remoteDebugCompletedCommandIds[remoteDebugCompletedCommandCount]), id);
    remoteDebugCompletedCommandCount++;
  }
}

void applyRemoteTestCenterConfig(JsonObject testCenter) {
  bool active = !testCenter.isNull() && (testCenter["active"] | false);
  String sessionId = active ? String(testCenter["session_id"] | "") : "";
  sessionId.trim();

  if (!active || !sessionId.length()) {
    if (remoteDebugActive) {
      remoteDebugActive = false;
      remoteDebugSessionId[0] = '\0';
      remoteDebugExpiresAtMs = 0;
      remoteDebugCompletedCommandCount = 0;
      remoteDebugRawMdb = false;
      remoteDebugRawDex = false;
    }
    return;
  }

  bool newSession = !remoteDebugActive || sessionId != remoteDebugSessionId;
  if (newSession) {
    copyText(remoteDebugSessionId, sizeof(remoteDebugSessionId), sessionId);
    remoteDebugCompletedCommandCount = 0;
    remoteDebugLastUploadMs = 0;
  }

  uint32_t expiresInSeconds = testCenter["expires_in_seconds"] | 0;
  if (expiresInSeconds > 3600UL) expiresInSeconds = 3600UL;
  remoteDebugExpiresAtMs = millis() + expiresInSeconds * 1000UL;
  remoteDebugRawMdb = testCenter["raw_mdb"] | false;
  remoteDebugRawDex = testCenter["raw_dex"] | false;
  remoteDebugHttpTrace = testCenter["http_trace"] | true;
  remoteDebugCupCounters = testCenter["cup_counters"] | true;
  remoteDebugMachineIdentity = testCenter["machine_identity"] | true;
  remoteDebugActive = true;

  if (newSession) {
    Serial.print(F("[TEST CENTER] remote session active id="));
    Serial.println(remoteDebugSessionId);
    Serial.println(F("[TEST CENTER] streaming mirrored Serial output; machine capture remains production-safe."));
    printStatus();
    if (remoteDebugMachineIdentity) printMachineIdentity();
    if (remoteDebugCupCounters) printCupCounters();
  }

  JsonArray commands = testCenter["commands"].as<JsonArray>();
  for (JsonObject command : commands) {
    String id = command["id"] | "";
    String value = command["command"] | "";
    executeRemoteDebugCommand(id, value);
  }
}

bool uploadRemoteDebugBatch() {
  if (!remoteDebugActive || !deviceEnrolled() || !anyDataTransportReady()) return false;
  if (remoteDebugCount == 0 && remoteDebugCompletedCommandCount == 0) return true;

  JsonDocument doc;
  addCommonPayload(doc, "debug_log_batch");
  doc["test_session_id"] = remoteDebugSessionId;
  doc["boot_id"] = bootId;
  doc["dropped_lines"] = remoteDebugDroppedLines;

  JsonArray lines = doc["lines"].to<JsonArray>();
  uint8_t added = 0;
  while (added < REMOTE_DEBUG_UPLOAD_LINES && added < remoteDebugCount) {
    uint16_t index = static_cast<uint16_t>((remoteDebugHead + added) % REMOTE_DEBUG_RING_LINES);
    RemoteDebugLine& source = remoteDebugRing[index];
    JsonObject line = lines.add<JsonObject>();
    line["seq"] = source.sequence;
    line["uptime_ms"] = source.uptimeMs;
    line["category"] = "serial";
    line["message"] = source.message;
    added++;
  }

  JsonArray completed = doc["completed_command_ids"].to<JsonArray>();
  for (uint8_t i = 0; i < remoteDebugCompletedCommandCount; ++i) {
    completed.add(remoteDebugCompletedCommandIds[i]);
  }

  // Never mirror the HTTP uploader's own Serial messages back into itself.
  remoteDebugCaptureSuppressed = true;
  bool ok = sendDocumentToIngest(doc);
  remoteDebugCaptureSuppressed = false;

  if (!ok) return false;

  if (added > 0) {
    remoteDebugHead = static_cast<uint16_t>((remoteDebugHead + added) % REMOTE_DEBUG_RING_LINES);
    remoteDebugCount -= added;
  }
  remoteDebugCompletedCommandCount = 0;
  remoteDebugDroppedLines = 0;
  return true;
}

void serviceRemoteDebug() {
  if (!remoteDebugActive) return;

  if (remoteDebugExpiresAtMs != 0
      && static_cast<int32_t>(millis() - remoteDebugExpiresAtMs) >= 0) {
    remoteDebugActive = false;
    remoteDebugSessionId[0] = '\0';
    remoteDebugRawMdb = false;
    remoteDebugRawDex = false;
    remoteDebugCompletedCommandCount = 0;
    return;
  }

  uint32_t now = millis();
  if (remoteDebugLastUploadMs != 0
      && now - remoteDebugLastUploadMs < REMOTE_DEBUG_UPLOAD_INTERVAL_MS) return;
  remoteDebugLastUploadMs = now;
  uploadRemoteDebugBatch();
}

bool syncRemotePolicy() {
  if (!deviceEnrolled()) return false;
  if (!wifiReady() && !cellReady) return false;

  String body;
  String usedTransport;
  int status = 0;
  if (!postRawWithFailover(CONFIG_URL, "{}", body, status, usedTransport, true)) return false;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.print(F("Config JSON parse failed: "));
    Serial.println(err.c_str());
    return false;
  }
  if (!doc["accepted"].as<bool>()) return false;

  JsonObject p = doc["policy"].as<JsonObject>();
  copyText(policy.mode, sizeof(policy.mode), p["mode"] | "live");
  copyText(policy.source, sizeof(policy.source), p["source"] | "default");
  copyText(policy.policyCode, sizeof(policy.policyCode), p["code"] | "live");
  copyText(policy.policyUpdatedAt, sizeof(policy.policyUpdatedAt), p["updated_at"] | "");
  copyText(policy.profileId, sizeof(policy.profileId), doc["assignment"]["profile_id"] | "");
  policy.counterIntervalMinutes = p["counter_interval_minutes"] | 5;
  policy.heartbeatIntervalMinutes = p["heartbeat_interval_minutes"] | 1;
  policy.configRefreshMinutes = p["config_refresh_minutes"] | 5;
  if (policy.counterIntervalMinutes == 0) policy.counterIntervalMinutes = 1;
  if (policy.heartbeatIntervalMinutes == 0) policy.heartbeatIntervalMinutes = 1;
  if (policy.configRefreshMinutes == 0) policy.configRefreshMinutes = 1;
  policy.immediateFaults = p["fault_reporting_immediate"] | true;
  policy.immediateRecovery = p["recovery_reporting_immediate"] | true;
  policy.counterDue = doc["actions"]["counter_due"] | false;
  policy.heartbeatDue = doc["actions"]["heartbeat_due"] | false;

  JsonObject control = doc["control"].as<JsonObject>();
  copyText(policy.transportPreference, sizeof(policy.transportPreference),
           control["transport_preference"] | "auto");
  policy.wifiEnabled = control["wifi_enabled"] | true;
  policy.cellularEnabled = control["cellular_enabled"] | true;
  JsonObject mdbControl = control["mdb"].as<JsonObject>();
  String remoteMasterPolarity = mdbControl["master_tx_polarity"] | "auto";
  String remoteSlavePolarity = mdbControl["slave_rx_polarity"] | "auto";
  remoteMasterPolarity.trim();
  remoteSlavePolarity.trim();
  remoteMasterPolarity.toLowerCase();
  remoteSlavePolarity.toLowerCase();
  if (remoteMasterPolarity != "auto" && remoteMasterPolarity != "normal" && remoteMasterPolarity != "inverted") {
    remoteMasterPolarity = "auto";
  }
  if (remoteSlavePolarity != "auto" && remoteSlavePolarity != "normal" && remoteSlavePolarity != "inverted") {
    remoteSlavePolarity = "auto";
  }
  copyText(policy.mdbMasterPolarity, sizeof(policy.mdbMasterPolarity), remoteMasterPolarity);
  copyText(policy.mdbSlavePolarity, sizeof(policy.mdbSlavePolarity), remoteSlavePolarity);
  applyConfiguredMdbPolarity(true);
  JsonObject cellularProfile = control["cellular_profile"].as<JsonObject>();
  String remoteApn = cellularProfile["apn"] | "";
  remoteApn.trim();
  if (remoteApn.length() && remoteApn != apn) {
    if (pppStarted) stopCellularPpp(true);
    apn = remoteApn;
    saveCoreSettings();
    cellModemRegistered = false;
    cellReady = false;
    lastCellAttemptMs = 0;
    Serial.print(F("Remote cellular APN saved; PPP will reconnect using: "));
    Serial.println(apn);
  }
  JsonObject prepaidControl = control["prepaid_balance"].as<JsonObject>();
  policy.prepaidBalanceEnabled = prepaidControl["enabled"] | true;
  policy.prepaidBalanceCheckIntervalMinutes = prepaidControl["check_interval_minutes"] | 360;
  policy.prepaidBalanceStaleAfterMinutes = prepaidControl["stale_after_minutes"] | 720;
  if (policy.prepaidBalanceCheckIntervalMinutes < 15) policy.prepaidBalanceCheckIntervalMinutes = 15;
  if (policy.prepaidBalanceStaleAfterMinutes < policy.prepaidBalanceCheckIntervalMinutes) {
    policy.prepaidBalanceStaleAfterMinutes = policy.prepaidBalanceCheckIntervalMinutes;
  }
  copyText(policy.prepaidBalanceUssdCode, sizeof(policy.prepaidBalanceUssdCode),
           prepaidControl["ussd_code"] | DEFAULT_PREPAID_BALANCE_USSD);
  policy.prepaidBalanceDue = doc["actions"]["prepaid_balance_due"] | false;
  JsonObject locationControl = control["location"].as<JsonObject>();
  policy.locationEnabled = locationControl["enabled"] | true;
  policy.locationIntervalMinutes = locationControl["interval_minutes"] | 15;
  policy.locationMinMoveM = locationControl["min_move_m"] | 50;
  policy.locationDue = doc["actions"]["location_due"] | false;

  applyRemoteTestCenterConfig(doc["test_center"].as<JsonObject>());

  counterUploadRequested |= policy.counterDue;
  heartbeatUploadRequested |= policy.heartbeatDue;
  lastConfigSuccessMs = millis();

  prefs.begin("dallmayr", false);
  prefs.putString("mode", policy.mode);
  prefs.putString("source", policy.source);
  prefs.putString("pcode", policy.policyCode);
  prefs.putString("pupdated", policy.policyUpdatedAt);
  prefs.putString("profile", policy.profileId);
  prefs.putString("transport", policy.transportPreference);
  prefs.putBool("wifi_on", policy.wifiEnabled);
  prefs.putBool("cell_on", policy.cellularEnabled);
  prefs.putString("mdb_mpol", policy.mdbMasterPolarity);
  prefs.putString("mdb_spol", policy.mdbSlavePolarity);
  prefs.putBool("bal_on", policy.prepaidBalanceEnabled);
  prefs.putULong("bal_min", policy.prepaidBalanceCheckIntervalMinutes);
  prefs.putULong("bal_stale", policy.prepaidBalanceStaleAfterMinutes);
  prefs.putString("bal_ussd", policy.prepaidBalanceUssdCode);
  prefs.putBool("loc_on", policy.locationEnabled);
  prefs.putULong("loc_min", policy.locationIntervalMinutes);
  prefs.putULong("loc_move", policy.locationMinMoveM);
  prefs.putULong("ctrmin", policy.counterIntervalMinutes);
  prefs.putULong("hbmin", policy.heartbeatIntervalMinutes);
  prefs.putULong("cfgmin", policy.configRefreshMinutes);
  prefs.end();

  configAckPending = true;
  lastConfigAckAttemptMs = 0;

  transportTransitionPending = false;
  transportTransitionSource[0] = '\0';
  bool configTransportWillBeDisabled =
    (usedTransport == "wifi" && !policy.wifiEnabled)
    || (usedTransport == "cellular" && !policy.cellularEnabled);
  if (configTransportWillBeDisabled) {
    transportTransitionPending = true;
    copyText(transportTransitionSource, sizeof(transportTransitionSource), usedTransport);
    lastTransportTransitionAttemptMs = 0;
    Serial.print(F("Transport change staged: keeping "));
    Serial.print(usedTransport);
    Serial.println(F(" alive until config ACK + heartbeat commit."));
  }

  Serial.print(F("Remote control synced via "));
  Serial.print(usedTransport);
  Serial.print(F(": mode="));
  Serial.print(policy.mode);
  Serial.print(F(" transport="));
  Serial.print(policy.transportPreference);
  Serial.print(F(" wifi="));
  Serial.print(policy.wifiEnabled ? "on" : "off");
  Serial.print(F(" cellular="));
  Serial.println(policy.cellularEnabled ? "on" : "off");
  Serial.print(F("MDB polarity config: GPIO4/master-TX="));
  Serial.print(policy.mdbMasterPolarity);
  Serial.print(F(" GPIO5/master-RX="));
  Serial.println(policy.mdbSlavePolarity);
  Serial.print(F("DB intervals min: heartbeat="));
  Serial.print(policy.heartbeatIntervalMinutes);
  Serial.print(F(" counters="));
  Serial.print(policy.counterIntervalMinutes);
  Serial.print(F(" config="));
  Serial.println(policy.configRefreshMinutes);
  return true;
}

void loadCachedPolicy() {
  memset(&policy, 0, sizeof(policy));
  copyText(policy.mode, sizeof(policy.mode), "live");
  copyText(policy.source, sizeof(policy.source), "cached-default");
  copyText(policy.policyCode, sizeof(policy.policyCode), "live");
  copyText(policy.policyUpdatedAt, sizeof(policy.policyUpdatedAt), "");
  copyText(policy.transportPreference, sizeof(policy.transportPreference), "auto");
  policy.counterIntervalMinutes = 5;
  policy.heartbeatIntervalMinutes = 1;
  policy.configRefreshMinutes = 5;
  policy.immediateFaults = true;
  policy.immediateRecovery = true;
  policy.wifiEnabled = true;
  policy.cellularEnabled = true;
  copyText(policy.mdbMasterPolarity, sizeof(policy.mdbMasterPolarity), "auto");
  copyText(policy.mdbSlavePolarity, sizeof(policy.mdbSlavePolarity), "auto");
  policy.prepaidBalanceEnabled = true;
  policy.prepaidBalanceDue = true;
  policy.prepaidBalanceCheckIntervalMinutes = 360;
  policy.prepaidBalanceStaleAfterMinutes = 720;
  copyText(policy.prepaidBalanceUssdCode, sizeof(policy.prepaidBalanceUssdCode), DEFAULT_PREPAID_BALANCE_USSD);
  policy.locationEnabled = true;
  policy.locationIntervalMinutes = 15;
  policy.locationMinMoveM = 50;
  policy.locationDue = true;

  prefs.begin("dallmayr", true);
  String mode = prefs.getString("mode", "");
  if (mode.length()) copyText(policy.mode, sizeof(policy.mode), mode);
  String source = prefs.getString("source", "");
  if (source.length()) copyText(policy.source, sizeof(policy.source), source);
  String policyCode = prefs.getString("pcode", "");
  if (policyCode.length()) copyText(policy.policyCode, sizeof(policy.policyCode), policyCode);
  String policyUpdatedAt = prefs.getString("pupdated", "");
  if (policyUpdatedAt.length()) copyText(policy.policyUpdatedAt, sizeof(policy.policyUpdatedAt), policyUpdatedAt);
  String profile = prefs.getString("profile", "");
  if (profile.length()) copyText(policy.profileId, sizeof(policy.profileId), profile);
  String transport = prefs.getString("transport", "");
  if (transport.length()) copyText(policy.transportPreference, sizeof(policy.transportPreference), transport);
  policy.wifiEnabled = prefs.getBool("wifi_on", policy.wifiEnabled);
  policy.cellularEnabled = prefs.getBool("cell_on", policy.cellularEnabled);
  String cachedMasterPolarity = prefs.getString("mdb_mpol", "");
  String cachedSlavePolarity = prefs.getString("mdb_spol", "");
  if (cachedMasterPolarity == "auto" || cachedMasterPolarity == "normal" || cachedMasterPolarity == "inverted") {
    copyText(policy.mdbMasterPolarity, sizeof(policy.mdbMasterPolarity), cachedMasterPolarity);
  }
  if (cachedSlavePolarity == "auto" || cachedSlavePolarity == "normal" || cachedSlavePolarity == "inverted") {
    copyText(policy.mdbSlavePolarity, sizeof(policy.mdbSlavePolarity), cachedSlavePolarity);
  }
  policy.prepaidBalanceEnabled = prefs.getBool("bal_on", policy.prepaidBalanceEnabled);
  policy.prepaidBalanceCheckIntervalMinutes = prefs.getULong("bal_min", policy.prepaidBalanceCheckIntervalMinutes);
  policy.prepaidBalanceStaleAfterMinutes = prefs.getULong("bal_stale", policy.prepaidBalanceStaleAfterMinutes);
  String balanceUssdCode = prefs.getString("bal_ussd", "");
  if (balanceUssdCode.length() && balanceUssdCode != RETIRED_PREPAID_BALANCE_USSD) {
    copyText(policy.prepaidBalanceUssdCode, sizeof(policy.prepaidBalanceUssdCode), balanceUssdCode);
  } else if (balanceUssdCode == RETIRED_PREPAID_BALANCE_USSD) {
    Serial.println(F("Replacing cached retired Vodacom balance code with *111*502#."));
  }
  policy.locationEnabled = prefs.getBool("loc_on", policy.locationEnabled);
  policy.locationIntervalMinutes = prefs.getULong("loc_min", policy.locationIntervalMinutes);
  policy.locationMinMoveM = prefs.getULong("loc_move", policy.locationMinMoveM);
  policy.counterIntervalMinutes = prefs.getULong("ctrmin", policy.counterIntervalMinutes);
  policy.heartbeatIntervalMinutes = prefs.getULong("hbmin", policy.heartbeatIntervalMinutes);
  policy.configRefreshMinutes = prefs.getULong("cfgmin", policy.configRefreshMinutes);
  prefs.end();
}

void maintainRemotePolicy() {
  if (!deviceEnrolled()) return;
  if (!wifiReady() && !cellReady) return;
  uint32_t refreshMinutes = policy.configRefreshMinutes == 0 ? 1 : policy.configRefreshMinutes;
  uint32_t interval = remoteDebugActive
    ? REMOTE_DEBUG_ACTIVE_CONFIG_POLL_MS
    : refreshMinutes * 60000UL;
  bool due = lastConfigSuccessMs == 0 || millis() - lastConfigSuccessMs >= interval;
  if (!due) return;
  uint32_t retryMs = CONFIG_RETRY_MS;
  if (millis() - lastConfigAttemptMs < retryMs && lastConfigAttemptMs != 0) return;
  lastConfigAttemptMs = millis();
  syncRemotePolicy();
}


bool runWifiDatabaseTest() {
  Serial.println(F("--- WIFI DB TEST: Wi-Fi only, cellular fallback disabled ---"));
  if (!deviceEnrolled()) {
    Serial.println(F("WIFI DB TEST FAILED: device is not enrolled."));
    return false;
  }
  if (!wifiSsid.length()) {
    Serial.println(F("WIFI DB TEST FAILED: Wi-Fi is not provisioned. Use WIFI SET <ssid>|<password>."));
    return false;
  }
  if (!wifiReady()) {
    Serial.println(F("WIFI DB TEST FAILED: Wi-Fi is not connected."));
    Serial.println(F("Run WIFI TEST and wait for an IP address first."));
    return false;
  }

  // Temporarily remove PPP from the control-plane failover helpers. This
  // guarantees every request in this diagnostic is actually carried by Wi-Fi.
  bool restartPppAfterTest = pppStarted || pppOnline;
  if (pppStarted) stopCellularPpp(true);
  cellModemRegistered = false;
  cellReady = false;

  lastConfigAttemptMs = 0;
  lastConfigSuccessMs = 0;
  bool configOk = syncRemotePolicy();
  if (!configOk) {
    if (restartPppAfterTest) lastCellAttemptMs = 0;
    Serial.println(F("WIFI DB TEST FAILED at CONFIG READ."));
    return false;
  }

  if (!wifiReady()) {
    if (restartPppAfterTest) lastCellAttemptMs = 0;
    Serial.println(F("WIFI DB TEST FAILED: Wi-Fi dropped after config read."));
    return false;
  }

  bool ackOk = uploadConfigAck();
  if (!ackOk) {
    if (restartPppAfterTest) lastCellAttemptMs = 0;
    Serial.println(F("WIFI DB TEST FAILED at CONFIG ACK."));
    return false;
  }

  if (!policy.wifiEnabled) {
    Serial.println(F("WIFI DB TEST: downloaded policy disables Wi-Fi; transport switch is deferred until the test heartbeat completes."));
  }

  heartbeatUploadRequested = true;
  bool heartbeatOk = uploadHeartbeatViaTransport("wifi");
  if (restartPppAfterTest) lastCellAttemptMs = 0;

  if (heartbeatOk && transportTransitionPending
      && strcmp(transportTransitionSource, "wifi") == 0) {
    transportTransitionPending = false;
    transportTransitionSource[0] = '\0';
    lastTransportTransitionAttemptMs = 0;
    Serial.println(F("WIFI DB TEST committed the pending transport change after the Wi-Fi heartbeat."));
  }

  if (!heartbeatOk) {
    Serial.println(F("WIFI DB TEST FAILED at HEARTBEAT WRITE."));
    return false;
  }

  Serial.println(F("WIFI DB TEST PASS: config read, config ACK and heartbeat all completed over Wi-Fi only."));
  Serial.print(F("Applied DB intervals min: heartbeat="));
  Serial.print(policy.heartbeatIntervalMinutes);
  Serial.print(F(" counters="));
  Serial.print(policy.counterIntervalMinutes);
  Serial.print(F(" config="));
  Serial.println(policy.configRefreshMinutes);
  return true;
}

// -----------------------------------------------------------------------------
// DEX/UCS parser and capture
// -----------------------------------------------------------------------------

void appendDexByte(uint8_t b) {
  if (dexText.length() >= DEX_TEXT_MAX) return;
  if (b == '\r' || b == '\n' || b == '~' || (b >= 0x20 && b <= 0x7E)) {
    dexText += static_cast<char>(b == '~' ? '\n' : b);
  }
}

void sendDexBlockAck() {
  DexSerial.write(0x10); // DLE
  DexSerial.write(dexAckToggle ? '1' : '0');
  dexAckToggle = !dexAckToggle;
}

void requestDexAudit() {
  if (machineInterface != IFACE_DEX) return;
  dexText = "";
  dexRequestActive = true;
  dexSawDataThisRequest = false;
  dexRequestStartedMs = millis();
  dexAckToggle = true;
  dexInBlock = false;
  dexSawDle = false;
  dexCrcBytesRemaining = 0;
  while (DexSerial.available()) DexSerial.read();

  // Common DEX initiation attempt. Some VMC revisions use the opposite
  // master/slave role; processDexSerial() also responds to an incoming ENQ.
  DexSerial.write(0x05); // ENQ
  DexSerial.flush();
  Serial.println(F("DEX audit requested."));
}

void parseDexText(const String& text) {
  if (text.length() == 0) return;
  Serial.print(F("Parsing DEX payload bytes="));
  Serial.println(text.length());

  String currentSelection;
  String currentProduct;
  uint32_t currentPriceCents = 0;
  bool sawProductCounter = false;

  int start = 0;
  while (start < text.length()) {
    int end = text.indexOf('\n', start);
    if (end < 0) end = text.length();
    String line = text.substring(start, end);
    line.replace("\r", "");
    line.trim();
    start = end + 1;
    if (line.length() < 2) continue;

    if (line.startsWith("ID1*")) {
      acceptDexId1(line);
      continue;
    }

    if (line.startsWith("ID4*")) {
      dexDecimalPlaces = fieldAt(line, 1).toInt();
      if (dexDecimalPlaces < 0 || dexDecimalPlaces > 4) dexDecimalPlaces = 2;
      continue;
    }

    if (line.startsWith("PA1*")) {
      currentSelection = trimCopy(fieldAt(line, 1));
      currentPriceCents = static_cast<uint32_t>(dexValueToCents(toUInt64(fieldAt(line, 2))));
      currentProduct = trimCopy(fieldAt(line, 3));
      continue;
    }

    if (line.startsWith("PA2*") && currentSelection.length()) {
      // Common DEX/UCS product layout:
      // PA2*historical_paid_vends*historical_sales_value*interval_vends*interval_sales...
      uint64_t sold = toUInt64(fieldAt(line, 1));
      uint64_t revenue = dexValueToCents(toUInt64(fieldAt(line, 2)));
      setCumulativeCounter(currentSelection, sold, revenue, currentPriceCents, currentProduct);
      sawProductCounter = true;
      continue;
    }

    if (line.startsWith("VA1*") && !sawProductCounter) {
      // Aggregate fallback for machines that do not expose PA1/PA2 per-selection records.
      uint64_t revenue = dexValueToCents(toUInt64(fieldAt(line, 1)));
      uint64_t sold = toUInt64(fieldAt(line, 2));
      setCumulativeCounter("TOTAL", sold, revenue, 0, "Machine total");
      continue;
    }

    if (line.startsWith("EA2*")) {
      String eventCode = trimCopy(fieldAt(line, 1));
      String userData = trimCopy(fieldAt(line, 4));
      bool active = trimCopy(fieldAt(line, 5)) == "1";
      String detail = "DEX event " + eventCode;
      if (userData.length()) detail += ": " + userData;
      setLocalFaultState(eventCode, active, active ? "fault" : "info",
                         "dex", detail, line);
      continue;
    }
  }

  if (dexRequestActive) {
    dexRequestActive = false;
    if (dexSawDataThisRequest) {
      setLocalFaultState("DEX_NO_RESPONSE", false, "warning", "dex",
                         "DEX communication restored", "");
    }
  }

  // Counter values are retained locally. Upload timing is controlled by the
  // effective database telemetry policy in serviceCounterSchedule().
}

void finishDexCapture() {
  if (dexText.length() == 0) return;
  String payload = dexText;
  dexText = "";

  if (remoteDebugActive && remoteDebugRawDex) {
    Serial.println(F("[DEX RAW BEGIN]"));
    int start = 0;
    uint8_t lines = 0;
    while (start < payload.length() && lines < 40) {
      int end = payload.indexOf('\n', start);
      if (end < 0) end = payload.length();
      String line = payload.substring(start, end);
      line.replace("\r", "");
      line.trim();
      if (line.length()) {
        Serial.print(F("[DEX RAW] "));
        Serial.println(line.substring(0, 420));
        lines++;
      }
      start = end + 1;
    }
    if (start < payload.length()) Serial.println(F("[DEX RAW] additional lines clipped locally"));
    Serial.println(F("[DEX RAW END]"));
  }

  parseDexText(payload);
}

void processDexSerial() {
  while (DexSerial.available()) {
    uint8_t b = DexSerial.read();
    lastDexByteMs = millis();
    dexSawDataThisRequest = true;

    // Reply to a VMC/data-carrier ENQ if it takes the opposite handshake role.
    if (!dexInBlock && b == 0x05) {
      DexSerial.write(0x06); // ACK
      continue;
    }

    if (dexCrcBytesRemaining > 0) {
      dexCrcBytesRemaining--;
      if (dexCrcBytesRemaining == 0) sendDexBlockAck();
      continue;
    }

    if (dexSawDle) {
      dexSawDle = false;
      if (b == 0x02) { // STX
        dexInBlock = true;
        continue;
      }
      if (b == 0x17 || b == 0x03) { // ETB / ETX
        dexInBlock = false;
        dexCrcBytesRemaining = 2;
        dexText += '\n';
        continue;
      }
      // DLE escaped / unknown: keep printable payload where useful.
      appendDexByte(b);
      continue;
    }

    if (b == 0x10) {
      dexSawDle = true;
      continue;
    }

    if (b == 0x04) { // EOT
      finishDexCapture();
      continue;
    }

    appendDexByte(b);
  }

  if (dexText.length() > 0 && millis() - lastDexByteMs > DEX_FRAME_IDLE_MS) {
    finishDexCapture();
  }

  if (dexRequestActive && millis() - dexRequestStartedMs > DEX_REQUEST_TIMEOUT_MS) {
    dexRequestActive = false;
    if (dexText.length()) finishDexCapture();
    if (!dexSawDataThisRequest) {
      setLocalFaultState("DEX_NO_RESPONSE", true, "warning", "dex",
                         "No DEX response within the audit request window", "");
      Serial.println(F("DEX audit timed out."));
    }
  }
}

// -----------------------------------------------------------------------------
// Normalized machine-record UART
// -----------------------------------------------------------------------------
// NORMALIZED_UART reads a machine-specific adapter on the DEX/SP3232 pins.
// Native MDB no longer uses this JSON/CSV bridge path; it is decoded directly
// from GPIO4/GPIO5 by the RMT-based MDB parser below.
//
// JSON examples:
//   {"type":"vend","selection":"A1","price_cents":1500,"result":"OK"}
//   {"type":"counter","selection":"A1","product":"Coffee","price_cents":1500,
//    "sold_total":123,"failed_total":2,"revenue_cents_total":184500}
//   {"type":"fault","code":"MDB_NO_RESPONSE","severity":"warning","detail":"..."}
//   {"type":"recovery","code":"MDB_NO_RESPONSE","detail":"..."}
//   {"type":"machine","machine_serial":"VM-12345"}
//
// CSV examples:
//   VEND,A1,1500,CARD,OK,123
//   COUNTER,A1,Coffee,1500,123,2,184500
//   FAULT,MDB_NO_RESPONSE,warning,No VMC reply
//   RECOVERY,MDB_NO_RESPONSE,Communication restored
//   MACHINE,VM-12345

String normalizedLine;
bool normalizedLineOverflow = false;

const char* normalizedRecordSource() {
  return "normalized_uart";
}

String csvFieldAt(const String& line, uint8_t wantedIndex) {
  uint8_t fieldIndex = 0;
  int start = 0;
  for (int i = 0; i <= line.length(); ++i) {
    if (i == line.length() || line.charAt(i) == ',') {
      if (fieldIndex == wantedIndex) return trimCopy(line.substring(start, i));
      fieldIndex++;
      start = i + 1;
    }
  }
  return "";
}

uint8_t csvFieldCount(const String& line) {
  if (!line.length()) return 0;
  uint8_t count = 1;
  for (int i = 0; i < line.length(); ++i) {
    if (line.charAt(i) == ',' && count < 255) count++;
  }
  return count;
}

void acceptMachineSerial(const String& serial) {
  String value = trimCopy(serial);
  if (!value.length() || value == reportedMachineSerial) return;
  reportedMachineSerial = value;
  saveCoreSettings();
  heartbeatUploadRequested = true;
  Serial.print(F("Machine serial received from interface: "));
  Serial.println(reportedMachineSerial);
}

void acceptMachineIdentityDetails(const String& serial,
                                  const String& model,
                                  const String& revision,
                                  const String& location,
                                  const String& asset,
                                  const String& source) {
  String cleanSerial = trimCopy(serial);
  String cleanModel = trimCopy(model);
  String cleanRevision = trimCopy(revision);
  String cleanLocation = trimCopy(location);
  String cleanAsset = trimCopy(asset);
  String cleanSource = trimCopy(source);

  if (cleanSerial.length()) acceptMachineSerial(cleanSerial);

  bool changed = false;
  if (cleanModel.length() && cleanModel != reportedMachineModel) {
    reportedMachineModel = cleanModel.substring(0, 80);
    changed = true;
  }
  if (cleanRevision.length() && cleanRevision != reportedMachineRevision) {
    reportedMachineRevision = cleanRevision.substring(0, 40);
    changed = true;
  }
  if (cleanLocation.length() && cleanLocation != reportedMachineLocation) {
    reportedMachineLocation = cleanLocation.substring(0, 80);
    changed = true;
  }
  if (cleanAsset.length() && cleanAsset != reportedMachineAsset) {
    reportedMachineAsset = cleanAsset.substring(0, 80);
    changed = true;
  }
  if (cleanSource.length() && cleanSource != machineIdentitySource) {
    machineIdentitySource = cleanSource.substring(0, 32);
    changed = true;
  }

  String seed = String("VMC|") + reportedMachineSerial + "|" + reportedMachineModel
      + "|" + reportedMachineRevision + "|" + reportedMachineAsset;
  String fingerprint = String("VMC-") + fingerprintHex(fnv1a32(seed));
  if (fingerprint != machineProfileFingerprint) {
    machineProfileFingerprint = fingerprint;
    changed = true;
  }

  if (changed) {
    saveCoreSettings();
    heartbeatUploadRequested = true;
    Serial.print(F("Machine identity/profile evidence updated source="));
    Serial.print(machineIdentitySource);
    Serial.print(F(" fingerprint="));
    Serial.println(machineProfileFingerprint);
  }
}

void acceptDexId1(const String& line) {
  // DEX/UCS ID1 commonly carries:
  // ID1*machine_serial*model*revision*location*...*asset
  // Optional fields vary by VMC, so empty values are preserved as unknown.
  String serial = trimCopy(fieldAt(line, 1));
  String model = trimCopy(fieldAt(line, 2));
  String revision = trimCopy(fieldAt(line, 3));
  String location = trimCopy(fieldAt(line, 4));
  String asset = trimCopy(fieldAt(line, 6));
  if (!asset.length()) asset = trimCopy(fieldAt(line, 5));

  if (!serial.length() && !model.length() && !asset.length()) return;
  acceptMachineIdentityDetails(serial, model, revision, location, asset, "dex_id1");
}

bool parseNormalizedLine(String line) {
  line.trim();
  if (!line.length()) return false;

  if (line.startsWith("{")) {
    JsonDocument doc;
    if (deserializeJson(doc, line)) return false;
    String type = doc["type"] | "";
    if (type.equalsIgnoreCase("vend")) {
      String selection = doc["selection"] | "UNKNOWN";
      uint32_t price = doc["price_cents"] | 0;
      String result = doc["result"] | "OK";
      bool success = result.equalsIgnoreCase("OK");
      if (!doc["counter"].isNull()) {
        uint64_t count = doc["counter"].as<uint64_t>();
        setCumulativeCounter(selection, count, count * price, price, "");
      } else {
        incrementLocalVend(selection, price, success);
      }
      return true;
    } else if (type.equalsIgnoreCase("counter") || type.equalsIgnoreCase("counter_snapshot")) {
      String selection = doc["selection"] | "UNKNOWN";
      String product = doc["product"] | "";
      uint32_t price = doc["price_cents"] | 0;
      uint64_t sold = doc["sold_total"].isNull() ? 0 : doc["sold_total"].as<uint64_t>();
      uint64_t failed = doc["failed_total"].isNull() ? 0 : doc["failed_total"].as<uint64_t>();
      uint64_t revenue = doc["revenue_cents_total"].isNull() ? 0 : doc["revenue_cents_total"].as<uint64_t>();
      setCompleteCounter(selection, product, price, sold, failed, revenue);
      return true;
    } else if (type.equalsIgnoreCase("fault")) {
      setLocalFaultState(doc["code"] | "UNKNOWN", true, doc["severity"] | "fault",
                         normalizedRecordSource(), doc["detail"] | "", line);
      return true;
    } else if (type.equalsIgnoreCase("recovery")) {
      setLocalFaultState(doc["code"] | "UNKNOWN", false, "info",
                         normalizedRecordSource(), doc["detail"] | "", line);
      return true;
    } else if (type.equalsIgnoreCase("machine")) {
      acceptMachineIdentityDetails(
        doc["machine_serial"] | "",
        doc["machine_model"] | "",
        doc["machine_revision"] | "",
        doc["machine_location"] | "",
        doc["machine_asset"] | "",
        "normalized_uart"
      );
      return true;
    }
    return false;
  }

  uint8_t fields = csvFieldCount(line);
  String recordType = csvFieldAt(line, 0);
  recordType.toUpperCase();

  if (recordType == "VEND" && fields >= 5) {
    String selection = csvFieldAt(line, 1);
    uint32_t price = static_cast<uint32_t>(csvFieldAt(line, 2).toInt());
    String result = csvFieldAt(line, 4);
    if (fields >= 6 && csvFieldAt(line, 5).length()) {
      uint64_t count = toUInt64(csvFieldAt(line, 5));
      setCumulativeCounter(selection, count, count * price, price, "");
    } else {
      incrementLocalVend(selection, price, result.equalsIgnoreCase("OK"));
    }
    return true;
  }

  if ((recordType == "COUNTER" || recordType == "COUNTER_SNAPSHOT") && fields >= 7) {
    setCompleteCounter(csvFieldAt(line, 1), csvFieldAt(line, 2),
                       static_cast<uint32_t>(csvFieldAt(line, 3).toInt()),
                       toUInt64(csvFieldAt(line, 4)),
                       toUInt64(csvFieldAt(line, 5)),
                       toUInt64(csvFieldAt(line, 6)));
    return true;
  }

  if (recordType == "FAULT" && fields >= 3) {
    setLocalFaultState(csvFieldAt(line, 1), true, csvFieldAt(line, 2),
                       normalizedRecordSource(), csvFieldAt(line, 3), line);
    return true;
  }

  if (recordType == "RECOVERY" && fields >= 2) {
    setLocalFaultState(csvFieldAt(line, 1), false, "info",
                       normalizedRecordSource(), csvFieldAt(line, 2), line);
    return true;
  }

  if (recordType == "MACHINE" && fields >= 2) {
    acceptMachineIdentityDetails(
      csvFieldAt(line, 1),
      fields >= 3 ? csvFieldAt(line, 2) : "",
      fields >= 4 ? csvFieldAt(line, 3) : "",
      "",
      fields >= 5 ? csvFieldAt(line, 4) : "",
      "normalized_uart"
    );
    return true;
  }

  return false;
}

void processNormalizedSerial() {
  while (DexSerial.available()) {
    char c = static_cast<char>(DexSerial.read());
    lastMachineByteMs = millis();
    if (c == '\r' || c == '\n') {
      if (normalizedLine.length()) {
        if (!normalizedLineOverflow && parseNormalizedLine(normalizedLine)) {
          acceptedMachineRecords++;
        } else {
          rejectedMachineRecords++;
          Serial.println(F("Machine UART record rejected; check bridge format and baud."));
        }
        normalizedLine = "";
        normalizedLineOverflow = false;
      }
    } else if (normalizedLine.length() < 512) {
      normalizedLine += c;
    } else {
      normalizedLineOverflow = true;
    }
  }
}

// -----------------------------------------------------------------------------
// Native passive MDB/ICP 9-bit capture / decoder
// -----------------------------------------------------------------------------
// MDB/ICP: 9600 NRZ, 1 start, 8 data (LSB first), 1 mode bit, 1 stop.
// Production mode is deliberately passive: BOTH MDB GPIOs are RMT RX inputs.
// The encoder below exists so framing is complete and unit-testable. This
// passive production build has no active bus-driving path by design.

static const size_t MDB_RMT_SYMBOL_CAPACITY =
    RMT_MEM_NUM_BLOCKS_2 * RMT_SYMBOLS_PER_CHANNEL_BLOCK;
static const size_t MDB_MAX_DECODED_BITS = 768;
static const size_t MDB_MAX_WORDS_PER_CAPTURE = 64;

static QueueHandle_t mdbEventQueue = nullptr;
static QueueHandle_t mdbRawDebugQueue = nullptr;
static volatile uint32_t mdbRawDebugQueueDrops = 0;

static const uint32_t MDB_RAW_DIAG_SAMPLE_MS = 10000UL;
static const uint16_t MDB_RAW_REPEAT_FLUSH_COUNT = 100;
static const uint32_t MDB_RAW_REPEAT_FLUSH_MS = 5000UL;

static MdbRawDebugFrame mdbLastRawMaster = {};
static MdbRawDebugFrame mdbLastRawSlave = {};
static bool mdbHaveLastRawMaster = false;
static bool mdbHaveLastRawSlave = false;
static uint16_t mdbPendingRawMasterRepeats = 0;
static uint16_t mdbPendingRawSlaveRepeats = 0;
static uint32_t mdbLastRawMasterFlushMs = 0;
static uint32_t mdbLastRawSlaveFlushMs = 0;
static uint32_t mdbLastMasterDiagMs = 0;
static uint32_t mdbLastSlaveDiagMs = 0;
static TaskHandle_t mdbCaptureTaskHandle = nullptr;
static volatile bool mdbCaptureTaskRun = false;
static volatile bool mdbMasterCaptureFault = false;
static volatile bool mdbSlaveCaptureFault = false;
static volatile uint32_t mdbEventQueueOverflows = 0;

static rmt_data_t mdbMasterRmt[MDB_RMT_SYMBOL_CAPACITY];
static rmt_data_t mdbSlaveRmt[MDB_RMT_SYMBOL_CAPACITY];
static size_t mdbMasterRmtCount = MDB_RMT_SYMBOL_CAPACITY;
static size_t mdbSlaveRmtCount = MDB_RMT_SYMBOL_CAPACITY;
static bool mdbMasterReadArmed = false;
static bool mdbSlaveReadArmed = false;
static bool mdbRmtReady = false;

// -1 unknown/auto-learning, 0 normal, 1 inverted.
static int8_t mdbMasterInvert = -1;
static int8_t mdbSlaveInvert = -1;
static char mdbAppliedMasterPolarity[12] = {0};
static char mdbAppliedSlavePolarity[12] = {0};

int8_t mdbConfiguredInvert(const char* mode) {
  if (!mode) return -1;
  if (strcmp(mode, "normal") == 0) return 0;
  if (strcmp(mode, "inverted") == 0) return 1;
  return -1;
}

void applyConfiguredMdbPolarity(bool announce, bool force) {
  bool masterModeChanged = force || strcmp(mdbAppliedMasterPolarity, policy.mdbMasterPolarity) != 0;
  bool slaveModeChanged = force || strcmp(mdbAppliedSlavePolarity, policy.mdbSlavePolarity) != 0;
  bool changed = false;

  if (masterModeChanged) {
    mdbMasterInvert = mdbConfiguredInvert(policy.mdbMasterPolarity);
    copyText(mdbAppliedMasterPolarity, sizeof(mdbAppliedMasterPolarity), policy.mdbMasterPolarity);
    changed = true;
  } else if (strcmp(policy.mdbMasterPolarity, "normal") == 0) {
    mdbMasterInvert = 0;
  } else if (strcmp(policy.mdbMasterPolarity, "inverted") == 0) {
    mdbMasterInvert = 1;
  }

  if (slaveModeChanged) {
    mdbSlaveInvert = mdbConfiguredInvert(policy.mdbSlavePolarity);
    copyText(mdbAppliedSlavePolarity, sizeof(mdbAppliedSlavePolarity), policy.mdbSlavePolarity);
    changed = true;
  } else if (strcmp(policy.mdbSlavePolarity, "normal") == 0) {
    mdbSlaveInvert = 0;
  } else if (strcmp(policy.mdbSlavePolarity, "inverted") == 0) {
    mdbSlaveInvert = 1;
  }

  // In Auto mode, an already learned 0/1 polarity is deliberately preserved
  // across routine config syncs. Only a real mode change back to Auto, or an
  // interface restart, returns the decoder to -1/learning.
  if (announce && changed) {
    Serial.print(F("MDB polarity applied: GPIO4/master-TX="));
    Serial.print(policy.mdbMasterPolarity);
    Serial.print(F(" GPIO5/master-RX="));
    Serial.println(policy.mdbSlavePolarity);
  }
}

static uint32_t mdbValidMasterBlocks = 0;
static uint32_t mdbValidSlaveBlocks = 0;
static uint32_t mdbInvalidMasterBlocks = 0;
static uint32_t mdbInvalidSlaveBlocks = 0;
static uint32_t mdbFramingErrors = 0;
static uint32_t mdbChecksumErrors = 0;
static uint32_t mdbDecodedWords = 0;
static uint32_t lastMdbValidMasterMs = 0;
static uint32_t lastMdbValidSlaveMs = 0;
static uint32_t mdbStartedMs = 0;

static MdbCashlessState mdbCashless[2];
static MdbLastMasterContext mdbLastMaster;
static MdbVendDedup mdbLastVend;

uint8_t mdbChecksum(const uint8_t* bytes, size_t count) {
  uint8_t sum = 0;
  for (size_t i = 0; i < count; ++i) sum = static_cast<uint8_t>(sum + bytes[i]);
  return sum;
}

// Complete 9-bit encoder for one MDB word. Bit positions:
// [0]=start, [1..8]=data LSB-first, [9]=mode, [10]=stop.
void mdbEncode9BitWord(uint8_t value, bool mode, bool outBits[11]) {
  outBits[0] = false;
  for (uint8_t bit = 0; bit < 8; ++bit) outBits[1 + bit] = ((value >> bit) & 0x01) != 0;
  outBits[9] = mode;
  outBits[10] = true;
}

// Build a complete Master->Peripheral MDB block, including the 8-bit checksum.
// The first byte is an ADDRESS byte (mode=1). Data and checksum use mode=0.
// This is not transmitted by production passive mode.
size_t mdbEncodeMasterBlock(uint8_t address,
                           const uint8_t* data,
                           size_t dataLength,
                           MdbWord* out,
                           size_t outCapacity) {
  if (!out || outCapacity < dataLength + 2 || dataLength > 34) return 0;

  out[0] = { address, true, true };
  uint8_t sum = address;
  for (size_t i = 0; i < dataLength; ++i) {
    out[i + 1] = { data[i], false, true };
    sum = static_cast<uint8_t>(sum + data[i]);
  }
  out[dataLength + 1] = { sum, false, true };
  return dataLength + 2;
}

uint32_t mdbScaledToCents(uint32_t scaled, uint8_t scaleFactor, uint8_t decimals) {
  uint64_t value = static_cast<uint64_t>(scaled) * (scaleFactor ? scaleFactor : 1);
  if (decimals < 2) {
    for (uint8_t i = decimals; i < 2; ++i) value *= 10ULL;
  } else if (decimals > 2) {
    for (uint8_t i = 2; i < decimals; ++i) value = (value + 5ULL) / 10ULL;
  }
  return value > 0xFFFFFFFFULL ? 0xFFFFFFFFUL : static_cast<uint32_t>(value);
}

String mdbSelectionText(uint16_t selection) {
  if (selection == 0xFFFF) return "MDB-UNKNOWN";
  char buf[20] = {0};
  snprintf(buf, sizeof(buf), "MDB-%u", static_cast<unsigned>(selection));
  return String(buf);
}

int mdbCashlessIndexForAddress(uint8_t address) {
  uint8_t base = address & 0xF8;
  if (base == 0x10) return 0;
  if (base == 0x60) return 1;
  return -1;
}

bool mdbIsCashlessAddress(uint8_t address) {
  return mdbCashlessIndexForAddress(address) >= 0;
}

bool mdbQueueTelemetryEvent(const MdbTelemetryEvent& event) {
  if (!mdbEventQueue) {
    mdbEventQueueOverflows++;
    return false;
  }
  if (xQueueSend(mdbEventQueue, &event, 0) != pdTRUE) {
    mdbEventQueueOverflows++;
    return false;
  }
  return true;
}

void mdbClearCashlessError(int idx, const char* detail) {
  (void)detail;
  if (idx < 0 || idx > 1) return;
  MdbCashlessState& s = mdbCashless[idx];
  if (!s.errorActive) return;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_CASHLESS_ERROR_CLEAR;
  event.readerIndex = static_cast<uint8_t>(idx);
  event.code = s.activeErrorCode;
  mdbQueueTelemetryEvent(event);

  s.errorActive = false;
  s.activeErrorCode = 0;
}

void mdbSetCashlessError(int idx, uint8_t errorCode) {
  if (idx < 0 || idx > 1) return;
  MdbCashlessState& s = mdbCashless[idx];

  if (s.errorActive && s.activeErrorCode == errorCode) return;

  if (s.errorActive && s.activeErrorCode != errorCode) {
    mdbClearCashlessError(idx, "MDB cashless error code changed");
  }

  s.activeErrorCode = errorCode;
  s.errorActive = true;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_CASHLESS_ERROR_SET;
  event.readerIndex = static_cast<uint8_t>(idx);
  event.code = errorCode;
  mdbQueueTelemetryEvent(event);
}

void mdbSetOutOfSequence(int idx, uint8_t status) {
  if (idx < 0 || idx > 1) return;
  MdbCashlessState& s = mdbCashless[idx];
  if (s.outOfSequenceActive) return;
  s.outOfSequenceActive = true;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_OUT_OF_SEQUENCE_SET;
  event.readerIndex = static_cast<uint8_t>(idx);
  event.status = status;
  mdbQueueTelemetryEvent(event);
}

void mdbClearOutOfSequence(int idx) {
  if (idx < 0 || idx > 1) return;
  MdbCashlessState& s = mdbCashless[idx];
  if (!s.outOfSequenceActive) return;
  s.outOfSequenceActive = false;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_OUT_OF_SEQUENCE_CLEAR;
  event.readerIndex = static_cast<uint8_t>(idx);
  mdbQueueTelemetryEvent(event);
}

bool mdbVendIsDuplicate(uint16_t selection, uint32_t priceCents, bool success) {
  uint32_t now = millis();
  bool duplicate =
      mdbLastVend.selection == selection &&
      mdbLastVend.priceCents == priceCents &&
      mdbLastVend.success == success &&
      mdbLastVend.atMs != 0 &&
      now - mdbLastVend.atMs <= MDB_DUPLICATE_VEND_WINDOW_MS;

  if (!duplicate) {
    mdbLastVend.selection = selection;
    mdbLastVend.priceCents = priceCents;
    mdbLastVend.success = success;
    mdbLastVend.atMs = now;
  }
  return duplicate;
}

uint8_t mdbVendReasonFromText(const char* reason) {
  if (!reason) return 0;
  if (strcmp(reason, "cashless_vend_success") == 0) return MDB_VEND_CASHLESS_SUCCESS;
  if (strcmp(reason, "cashless_vend_failure") == 0) return MDB_VEND_CASHLESS_FAILURE;
  if (strcmp(reason, "cash_sale") == 0) return MDB_VEND_CASH_SALE;
  if (strcmp(reason, "cashless_reset_after_approval") == 0) return MDB_VEND_RESET_AFTER_APPROVAL;
  if (strcmp(reason, "cashless_basket_vend_success") == 0) return MDB_VEND_BASKET_SUCCESS;
  if (strcmp(reason, "cashless_basket_vend_failure") == 0) return MDB_VEND_BASKET_FAILURE;
  if (strcmp(reason, "free_vend") == 0) return MDB_VEND_FREE_VEND;
  return 0;
}

void mdbRecordVend(uint16_t selection, uint32_t priceCents, bool success, const char* reason) {
  if (mdbVendIsDuplicate(selection, priceCents, success)) return;

  MdbTelemetryEvent event = {};
  event.type = MDB_EVENT_VEND;
  event.selection = selection;
  event.priceCents = priceCents;
  event.success = success;
  event.reason = mdbVendReasonFromText(reason);
  mdbQueueTelemetryEvent(event);
}

const char* mdbVendReasonName(uint8_t reason) {
  switch (reason) {
    case MDB_VEND_CASHLESS_SUCCESS: return "cashless_vend_success";
    case MDB_VEND_CASHLESS_FAILURE: return "cashless_vend_failure";
    case MDB_VEND_CASH_SALE: return "cash_sale";
    case MDB_VEND_RESET_AFTER_APPROVAL: return "cashless_reset_after_approval";
    case MDB_VEND_BASKET_SUCCESS: return "cashless_basket_vend_success";
    case MDB_VEND_BASKET_FAILURE: return "cashless_basket_vend_failure";
    case MDB_VEND_FREE_VEND: return "free_vend";
    default: return "mdb";
  }
}

void serviceMdbTelemetryEvents(uint8_t maxEvents = 24) {
  if (!mdbEventQueue) return;

  MdbTelemetryEvent event = {};
  uint8_t handled = 0;
  while (handled < maxEvents && xQueueReceive(mdbEventQueue, &event, 0) == pdTRUE) {
    handled++;

    if (event.type == MDB_EVENT_VEND) {
      String selectionText = mdbSelectionText(event.selection);
      incrementLocalVend(selectionText, event.priceCents, event.success);
      Serial.print(F("MDB vend "));
      Serial.print(event.success ? F("success") : F("failure"));
      Serial.print(F(" selection="));
      Serial.print(selectionText);
      Serial.print(F(" price_cents="));
      Serial.print(event.priceCents);
      Serial.print(F(" source="));
      Serial.println(mdbVendReasonName(event.reason));
      continue;
    }

    if (event.readerIndex > 1) continue;
    int reader = event.readerIndex + 1;
    char code[48] = {0};

    if (event.type == MDB_EVENT_CASHLESS_ERROR_SET) {
      snprintf(code, sizeof(code), "MDB_CASHLESS%d_ERROR_%02X", reader, event.code);
      String detail = "Cashless reader ";
      detail += String(reader);
      detail += " reported MDB malfunction/error 0x";
      if (event.code < 16) detail += "0";
      detail += String(event.code, HEX);
      detail.toUpperCase();
      setLocalFaultState(code, true, "fault", "mdb", detail, "");
    } else if (event.type == MDB_EVENT_CASHLESS_ERROR_CLEAR) {
      snprintf(code, sizeof(code), "MDB_CASHLESS%d_ERROR_%02X", reader, event.code);
      setLocalFaultState(code, false, "info", "mdb", "MDB cashless error cleared", "");
    } else if (event.type == MDB_EVENT_OUT_OF_SEQUENCE_SET) {
      snprintf(code, sizeof(code), "MDB_CASHLESS%d_OUT_OF_SEQUENCE", reader);
      String detail = "MDB cashless command out of sequence";
      if (event.status) {
        detail += " status=";
        detail += String(event.status);
      }
      setLocalFaultState(code, true, "warning", "mdb", detail, "");
    } else if (event.type == MDB_EVENT_OUT_OF_SEQUENCE_CLEAR) {
      snprintf(code, sizeof(code), "MDB_CASHLESS%d_OUT_OF_SEQUENCE", reader);
      setLocalFaultState(code, false, "info", "mdb", "MDB cashless sequence restored", "");
    }
  }
}

void printMdbWordList(const uint8_t* values, uint32_t modeMask, uint8_t count) {
  for (uint8_t i = 0; i < count; ++i) {
    if (i) Serial.print(' ');
    if ((modeMask & (1UL << i)) != 0) Serial.print('^');
    if (values[i] < 0x10) Serial.print('0');
    Serial.print(values[i], HEX);
  }
}

void serviceMdbRawDebugEvents(uint8_t maxFrames = 4) {
  if (!remoteDebugActive || !remoteDebugRawMdb || !mdbRawDebugQueue) return;

  MdbRawDebugFrame frame = {};
  uint8_t handled = 0;
  while (handled < maxFrames && xQueueReceive(mdbRawDebugQueue, &frame, 0) == pdTRUE) {
    handled++;

    Serial.print(F("[MDB RAW] "));
    Serial.print(frame.masterDirection ? F("MASTER ") : F("SLAVE "));
    if (frame.count == 0) Serial.print(F("<no decoded words>"));
    else printMdbWordList(frame.values, frame.modeMask, frame.count);
    if (frame.repeatCount > 1) {
      Serial.print(F(" x"));
      Serial.print(frame.repeatCount);
    }
    Serial.println();

    if (frame.diagnosticSample) {
      Serial.print(F("[MDB DIAG] "));
      Serial.print(frame.masterDirection ? F("MASTER NORMAL score=") : F("SLAVE NORMAL score="));
      Serial.print(frame.normalScore);
      Serial.print(F(" words="));
      Serial.print(frame.normalCount);
      Serial.print(F(" : "));
      printMdbWordList(frame.normalValues, frame.normalModeMask, frame.normalCount);
      Serial.println();

      Serial.print(F("[MDB DIAG] "));
      Serial.print(frame.masterDirection ? F("MASTER INVERTED score=") : F("SLAVE INVERTED score="));
      Serial.print(frame.invertedScore);
      Serial.print(F(" words="));
      Serial.print(frame.invertedCount);
      Serial.print(F(" : "));
      printMdbWordList(frame.invertedValues, frame.invertedModeMask, frame.invertedCount);
      Serial.println();

      Serial.print(F("[MDB PULSE] "));
      Serial.print(frame.masterDirection ? F("GPIO4/master-TX ") : F("GPIO5/master-RX "));
      for (uint8_t i = 0; i < frame.pulseCount; ++i) {
        if (i) Serial.print(' ');
        Serial.print(frame.pulseLevels[i] ? 'H' : 'L');
        Serial.print(frame.pulseDurationsUs[i]);
        Serial.print(F("us"));
      }
      Serial.println();
    }
  }

  static uint32_t lastReportedDrops = 0;
  uint32_t drops = mdbRawDebugQueueDrops;
  if (drops != lastReportedDrops) {
    Serial.print(F("[MDB RAW] capture queue dropped frames total="));
    Serial.println(drops);
    lastReportedDrops = drops;
  }
}

uint32_t mdbReadBigEndian(const MdbWord* words, size_t offset, size_t bytes) {
  uint32_t value = 0;
  for (size_t i = 0; i < bytes; ++i) {
    value = (value << 8) | words[offset + i].value;
  }
  return value;
}

void mdbCopyAsciiField(const MdbWord* data, size_t offset, size_t length,
                       char* out, size_t outSize) {
  if (!data || !out || outSize == 0) return;
  size_t n = min(length, outSize - 1);
  for (size_t i = 0; i < n; ++i) {
    uint8_t raw = data[offset + i].value;
    out[i] = (raw >= 0x20 && raw <= 0x7E) ? static_cast<char>(raw) : ' ';
  }
  out[n] = '\0';
  while (n > 0 && out[n - 1] == ' ') out[--n] = '\0';
}

void updateMdbProfileFingerprint() {
  String seed = "MDB";
  bool evidence = false;

  for (uint8_t i = 0; i < 2; ++i) {
    MdbCashlessState& reader = mdbCashless[i];
    if (!reader.scaleKnown && !reader.peripheralIdKnown
        && reader.supportedFeatureBits == 0 && reader.enabledFeatureBits == 0) {
      continue;
    }

    evidence = true;
    seed += "|R";
    seed += String(i + 1);
    seed += "|L";
    seed += String(reader.featureLevel);
    seed += "|S";
    seed += String(reader.scaleFactor);
    seed += "|D";
    seed += String(reader.decimalPlaces);
    seed += "|M";
    seed += String(reader.manufacturer);
    seed += "|P";
    seed += String(reader.peripheralSerial);
    seed += "|N";
    seed += String(reader.modelNumber);
    seed += "|V";
    seed += String(reader.softwareVersion);
    seed += "|SF";
    seed += String(reader.supportedFeatureBits, HEX);
    seed += "|EF";
    seed += String(reader.enabledFeatureBits, HEX);
  }

  if (!evidence) return;

  String fingerprint = String("MDB-") + fingerprintHex(fnv1a32(seed));
  bool changed = false;

  // Never downgrade an exact DEX/normalized machine identity to an MDB reader
  // signature. MDB is profile evidence only.
  if (!machineIdentitySource.length()
      || machineIdentitySource.equalsIgnoreCase("mdb_bus_signature")) {
    if (!machineIdentitySource.equalsIgnoreCase("mdb_bus_signature")) {
      machineIdentitySource = "mdb_bus_signature";
      changed = true;
    }
    if (fingerprint != machineProfileFingerprint) {
      machineProfileFingerprint = fingerprint;
      changed = true;
    }
  }

  if (changed) {
    saveCoreSettings();
    heartbeatUploadRequested = true;
    Serial.print(F("MDB passive profile fingerprint: "));
    Serial.println(machineProfileFingerprint);
  }
}

// Convert RMT pulse durations to an MDB serial bit stream, then reconstruct
// 11-bit MDB words. RMT starts on the first edge, so searching for start=0
// and validating stop=1 is safer than assuming symbol alignment.
size_t mdbDecodeRmtWords(const rmt_data_t* symbols,
                         size_t symbolCount,
                         bool invert,
                         MdbWord* outWords,
                         size_t outCapacity,
                         uint32_t& framingErrors) {
  bool bits[MDB_MAX_DECODED_BITS];
  size_t bitCount = 0;

  auto appendPulse = [&](uint8_t rawLevel, uint16_t duration) {
    if (duration == 0 || bitCount >= MDB_MAX_DECODED_BITS) return;
    bool logicalLevel = (rawLevel != 0) ^ invert;

    // Round to the nearest 9600-baud bit period. Reject pulses that are too
    // short to represent a stable MDB bit after the hardware noise filter.
    if (duration < MDB_BIT_US / 2) return;
    uint32_t repeat = (static_cast<uint32_t>(duration) + MDB_BIT_US / 2) / MDB_BIT_US;
    if (repeat == 0) repeat = 1;
    // Long idle or bus-reset levels need not consume the whole scratch buffer.
    if (repeat > 32) repeat = 32;
    while (repeat-- && bitCount < MDB_MAX_DECODED_BITS) bits[bitCount++] = logicalLevel;
  };

  for (size_t i = 0; i < symbolCount && bitCount < MDB_MAX_DECODED_BITS; ++i) {
    appendPulse(symbols[i].level0, symbols[i].duration0);
    appendPulse(symbols[i].level1, symbols[i].duration1);
  }

  // ESP32-S3 RMT RX ends the capture after MDB_RX_IDLE_US of inactivity. On
  // the deployed isolated MDB interface the terminal idle run is not included
  // in the returned symbol list. That leaves a complete final MDB word short
  // by its stop/idle bit (for example ^18 18 arrives as 21 reconstructed bits
  // instead of 22), so the checksum byte is discarded.
  //
  // A capture that completed because the line reached the configured idle
  // threshold gives us one safe fact: the logical bus is idle/high after the
  // final reported edge. Add exactly one logical idle bit. This is sufficient
  // to close a missing stop bit without inventing data bits or changing any
  // physical I/O behavior.
  if (bitCount < MDB_MAX_DECODED_BITS) {
    bits[bitCount++] = true;
  }

  size_t wordCount = 0;
  for (size_t i = 0; i + 10 < bitCount && wordCount < outCapacity;) {
    // UART start bit must be low. Prefer a low preceded by idle/high.
    if (bits[i] || (i > 0 && !bits[i - 1])) {
      ++i;
      continue;
    }

    if (!bits[i + 10]) {
      ++framingErrors;
      ++i;
      continue;
    }

    uint8_t value = 0;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      if (bits[i + 1 + bit]) value |= static_cast<uint8_t>(1U << bit);
    }
    outWords[wordCount++] = { value, bits[i + 9], true };
    i += 11;
  }
  return wordCount;
}

bool mdbMasterSegmentChecksumValid(const MdbWord* words,
                                   size_t start,
                                   size_t endInclusive,
                                   size_t& checksumIndex) {
  if (!words || endInclusive <= start) return false;

  // Normal case: final word in this address segment is the checksum.
  auto checkCandidate = [&](size_t candidate) {
    if (candidate <= start || words[candidate].mode) return false;
    uint8_t sum = 0;
    for (size_t j = start; j < candidate; ++j) sum = static_cast<uint8_t>(sum + words[j].value);
    return sum == words[candidate].value;
  };

  if (checkCandidate(endInclusive)) {
    checksumIndex = endInclusive;
    return true;
  }

  // If a Master ACK/NAK/RET was captured immediately after the command,
  // allow one trailing non-address control byte after a valid checksum.
  if (endInclusive > start + 1 && checkCandidate(endInclusive - 1)) {
    uint8_t trailing = words[endInclusive].value;
    if (!words[endInclusive].mode && (trailing == 0x00 || trailing == 0xAA || trailing == 0xFF)) {
      checksumIndex = endInclusive - 1;
      return true;
    }
  }
  return false;
}

int mdbScoreMasterWords(const MdbWord* words, size_t count) {
  int score = 0;
  for (size_t i = 0; i < count;) {
    if (!words[i].mode) { ++i; continue; }

    size_t segmentEnd = i + 1;
    while (segmentEnd + 1 < count &&
           !words[segmentEnd + 1].mode &&
           segmentEnd + 1 <= i + 35) {
      ++segmentEnd;
    }

    size_t checksumIndex = 0;
    if (mdbMasterSegmentChecksumValid(words, i, segmentEnd, checksumIndex)) score += 10;
    else score += 1;

    i = segmentEnd + 1;
  }
  return score;
}

int mdbScoreSlaveWords(const MdbWord* words, size_t count) {
  int score = 0;
  uint8_t sum = 0;
  size_t dataCount = 0;
  for (size_t i = 0; i < count; ++i) {
    if (!words[i].mode) {
      sum = static_cast<uint8_t>(sum + words[i].value);
      dataCount++;
      continue;
    }

    if (dataCount == 0) {
      // Single mode-set ACK/NAK/RET style response.
      score += 5;
    } else if (words[i].value == sum) {
      score += 10;
    }
    sum = 0;
    dataCount = 0;
  }
  return score;
}

size_t mdbDecodeWithPolarity(const rmt_data_t* symbols,
                             size_t symbolCount,
                             bool masterDirection,
                             int8_t& learnedInvert,
                             MdbWord* outWords,
                             size_t outCapacity) {
  MdbWord normal[MDB_MAX_WORDS_PER_CAPTURE];
  MdbWord inverted[MDB_MAX_WORDS_PER_CAPTURE];
  uint32_t normalErrors = 0;
  uint32_t invertedErrors = 0;

  if (!DALLMAYR_MDB_AUTO_POLARITY && learnedInvert < 0) learnedInvert = 0;

  if (learnedInvert >= 0) {
    size_t n = mdbDecodeRmtWords(symbols, symbolCount, learnedInvert != 0,
                                 outWords, outCapacity, normalErrors);
    mdbFramingErrors += normalErrors;
    return n;
  }

  size_t normalCount = mdbDecodeRmtWords(symbols, symbolCount, false,
                                         normal, MDB_MAX_WORDS_PER_CAPTURE, normalErrors);
  size_t invertedCount = mdbDecodeRmtWords(symbols, symbolCount, true,
                                           inverted, MDB_MAX_WORDS_PER_CAPTURE, invertedErrors);
  int normalScore = masterDirection ? mdbScoreMasterWords(normal, normalCount)
                                    : mdbScoreSlaveWords(normal, normalCount);
  int invertedScore = masterDirection ? mdbScoreMasterWords(inverted, invertedCount)
                                      : mdbScoreSlaveWords(inverted, invertedCount);

  bool chooseInverted = invertedScore > normalScore;
  const MdbWord* chosen = chooseInverted ? inverted : normal;
  size_t chosenCount = chooseInverted ? invertedCount : normalCount;
  mdbFramingErrors += chooseInverted ? invertedErrors : normalErrors;

  // Only lock polarity after meaningful valid-block evidence.
  if (max(normalScore, invertedScore) >= 10) {
    learnedInvert = chooseInverted ? 1 : 0;
  }

  size_t copyCount = min(chosenCount, outCapacity);
  for (size_t i = 0; i < copyCount; ++i) outWords[i] = chosen[i];
  return copyCount;
}

void mdbHandleMasterBlock(const MdbWord* block, size_t count) {
  if (count < 2) return;
  uint8_t address = block[0].value;
  uint8_t command = address & 0x07;
  uint8_t subcommand = count >= 3 ? block[1].value : 0xFF;

  mdbLastMaster.address = address;
  mdbLastMaster.command = command;
  mdbLastMaster.subcommand = subcommand;
  mdbLastMaster.atMs = millis();

  int cashlessIdx = mdbCashlessIndexForAddress(address);
  if (cashlessIdx < 0) return;

  MdbCashlessState& cashless = mdbCashless[cashlessIdx];

  // RESET = 10h/60h. MDB specifies that a reset occurring after VEND
  // APPROVED but before VEND SUCCESS is interpreted as a successful vend.
  // Preserve that accounting before clearing the reader state.
  if (command == 0) {
    if (cashless.vendPending && cashless.vendApproved) {
      uint32_t scaled = cashless.approvedScaledPrice
                      ? cashless.approvedScaledPrice
                      : cashless.requestedScaledPrice;
      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);
      mdbRecordVend(cashless.selection, cents, true, "cashless_reset_after_approval");
    }
    cashless.vendPending = false;
    cashless.vendApproved = false;
    cashless.selection = 0xFFFF;
    cashless.requestedScaledPrice = 0;
    cashless.approvedScaledPrice = 0;
    cashless.enabledFeatureBits = 0;
    cashless.expandedCurrency = false;
    mdbClearOutOfSequence(cashlessIdx);
    return;
  }

  // EXPANSION = 17h/67h, subcommand 04h = ENABLE OPTIONS.
  // Y2..Y5 are the 32-bit optional-feature bitmap in network byte order.
  // Bit 1 enables 32-bit monetary fields and bit 2 enables multi-currency;
  // either feature causes the expanded monetary representation to be used.
  if (command == 7 && subcommand == 0x04 && count >= 7) {
    cashless.enabledFeatureBits = mdbReadBigEndian(block, 2, 4);
    cashless.expandedCurrency =
        (cashless.enabledFeatureBits & ((1UL << 1) | (1UL << 2))) != 0;
    updateMdbProfileFingerprint();
    return;
  }

  // VEND = 13h/63h
  if (command != 3 || count < 3) return;

  switch (subcommand) {
    case 0x00: { // VEND REQUEST
      // Standard: addr,00,priceHi,priceLo,itemHi,itemLo,chk
      // Expanded currency: addr,00,price[4],itemHi,itemLo,chk
      size_t payloadWithoutChecksum = count - 1;
      size_t priceBytes = cashless.expandedCurrency ? 4 : 2;
      size_t itemOffset = 2 + priceBytes;
      if (itemOffset + 1 >= payloadWithoutChecksum) break;

      cashless.requestedScaledPrice = mdbReadBigEndian(block, 2, priceBytes);
      cashless.selection = static_cast<uint16_t>(mdbReadBigEndian(block, itemOffset, 2));
      cashless.approvedScaledPrice = 0;
      cashless.vendPending = true;
      cashless.vendApproved = false;
      cashless.vendStartedMs = millis();
      break;
    }

    case 0x01: // VEND CANCEL
      cashless.vendPending = false;
      cashless.vendApproved = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      break;

    case 0x02: { // VEND SUCCESS
      size_t payloadWithoutChecksum = count - 1;
      bool basketEnabled = (cashless.enabledFeatureBits & (1UL << 7)) != 0;
      bool enhancedItem = (cashless.enabledFeatureBits & (1UL << 10)) != 0;

      uint16_t selection = cashless.selection;
      if (payloadWithoutChecksum >= 4) {
        uint16_t selected = static_cast<uint16_t>(mdbReadBigEndian(block, 2, 2));
        if (selected != 0xFFFF) selection = selected;
      }

      // Enhanced Item Number Info adds a distinct dispensed item number at
      // Y4-Y5. Prefer the actual dispensed location when the VMC supplies it.
      if (enhancedItem && payloadWithoutChecksum >= 6) {
        uint16_t dispensed = static_cast<uint16_t>(mdbReadBigEndian(block, 4, 2));
        if (dispensed != 0xFFFF) selection = dispensed;
      }

      uint32_t scaled = cashless.approvedScaledPrice
                      ? cashless.approvedScaledPrice
                      : cashless.requestedScaledPrice;
      uint32_t remainingItems = 0;

      // With Basket / Partial Refund enabled, VEND SUCCESS carries the
      // monetary amount for this individual dispensed item. This avoids
      // attributing the entire basket approval amount to every item.
      if (basketEnabled) {
        size_t amountBytes = cashless.expandedCurrency ? 4 : 2;
        size_t amountOffset = enhancedItem ? 18 : 4;
        size_t itemCountOffset = amountOffset + amountBytes;
        if (itemCountOffset < payloadWithoutChecksum) {
          scaled = mdbReadBigEndian(block, amountOffset, amountBytes);
          remainingItems = block[itemCountOffset].value;
        }
      }

      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);
      if (cashless.vendPending || selection != 0xFFFF) {
        mdbRecordVend(selection, cents, true,
                      basketEnabled ? "cashless_basket_vend_success" : "cashless_vend_success");
      }

      // Basket mode can emit multiple SUCCESS/FAILURE commands after one
      // VEND REQUEST. Keep the transaction context only while items remain.
      cashless.vendPending = basketEnabled && remainingItems > 0;
      cashless.vendApproved = cashless.vendPending;
      if (!cashless.vendPending) {
        cashless.selection = 0xFFFF;
        cashless.requestedScaledPrice = 0;
        cashless.approvedScaledPrice = 0;
      }
      break;
    }

    case 0x03: { // VEND FAILURE
      size_t payloadWithoutChecksum = count - 1;
      bool basketEnabled = (cashless.enabledFeatureBits & (1UL << 7)) != 0;
      uint16_t selection = cashless.selection;
      uint32_t scaled = cashless.approvedScaledPrice
                      ? cashless.approvedScaledPrice
                      : cashless.requestedScaledPrice;
      uint32_t remainingItems = 0;

      // Level-3 Basket / Partial Refund failure contains the failed item,
      // its amount and the number of products still awaiting disposition.
      if (basketEnabled && payloadWithoutChecksum >= 4) {
        uint16_t reported = static_cast<uint16_t>(mdbReadBigEndian(block, 2, 2));
        if (reported != 0xFFFF) selection = reported;
        size_t amountBytes = cashless.expandedCurrency ? 4 : 2;
        size_t amountOffset = 4;
        size_t itemCountOffset = amountOffset + amountBytes;
        if (itemCountOffset < payloadWithoutChecksum) {
          scaled = mdbReadBigEndian(block, amountOffset, amountBytes);
          remainingItems = block[itemCountOffset].value;
        }
      }

      uint32_t cents = mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);
      if (cashless.vendPending || (basketEnabled && selection != 0xFFFF)) {
        mdbRecordVend(selection, cents, false,
                      basketEnabled ? "cashless_basket_vend_failure" : "cashless_vend_failure");
      }

      cashless.vendPending = basketEnabled && remainingItems > 0;
      cashless.vendApproved = cashless.vendPending;
      if (!cashless.vendPending) {
        cashless.selection = 0xFFFF;
        cashless.requestedScaledPrice = 0;
        cashless.approvedScaledPrice = 0;
      }
      break;
    }

    case 0x04: // SESSION COMPLETE
      cashless.vendPending = false;
      cashless.vendApproved = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      break;

    case 0x05: { // CASH SALE / audit notification, including FREE VEND
      // MDB specifies that free/test/negative/token audit vends may be encoded
      // in the high four bits of the 16-bit Item Number. Nayax can therefore
      // report a completed free vend even though no VEND REQUEST/APPROVED
      // payment sequence occurred.
      //
      //   bit 15 = free vend
      //   bit 14 = test vend
      //   bit 13 = negative vend
      //   bit 12 = token vend
      //
      // Preserve the actual product/channel in the lower 12 bits.
      size_t payloadWithoutChecksum = count - 1;
      size_t priceBytes = cashless.expandedCurrency ? 4 : 2;
      size_t itemOffset = 2 + priceBytes;
      if (itemOffset + 1 >= payloadWithoutChecksum) break;

      uint32_t scaled = mdbReadBigEndian(block, 2, priceBytes);
      uint16_t rawItemNumber =
          static_cast<uint16_t>(mdbReadBigEndian(block, itemOffset, 2));

      bool freeVend = (rawItemNumber & 0x8000U) != 0;
      bool testVend = (rawItemNumber & 0x4000U) != 0;
      bool negativeVend = (rawItemNumber & 0x2000U) != 0;
      bool tokenVend = (rawItemNumber & 0x1000U) != 0;
      uint16_t selection = rawItemNumber & 0x0FFFU;

      // FFFF still means item undefined/not implemented. Do not manufacture a
      // false channel number when all lower bits are set.
      if (rawItemNumber == 0xFFFFU) selection = 0xFFFFU;

      uint32_t cents =
          mdbScaledToCents(scaled, cashless.scaleFactor, cashless.decimalPlaces);

      if (freeVend) {
        // A free vend is a successful physical dispense with zero revenue.
        // Count the unit but do not create artificial sales value.
        mdbRecordVend(selection, 0, true, "free_vend");
        Serial.print(F("MDB free-vend audit observed raw_item=0x"));
        Serial.print(rawItemNumber, HEX);
        Serial.print(F(" selection="));
        Serial.print(mdbSelectionText(selection));
        Serial.print(F(" flags=test:"));
        Serial.print(testVend ? 1 : 0);
        Serial.print(F(" negative:"));
        Serial.print(negativeVend ? 1 : 0);
        Serial.print(F(" token:"));
        Serial.println(tokenVend ? 1 : 0);
      } else {
        // Existing paid/cash audit behaviour remains unchanged.
        mdbRecordVend(selection, cents, true, "cash_sale");
      }
      break;
    }

    default:
      break;
  }
}

size_t mdbCashlessMessageLength(const MdbCashlessState& cashless,
                                const MdbWord* data,
                                size_t remaining) {
  if (!data || remaining == 0) return 0;
  switch (data[0].value) {
    case 0x00: return 1; // JUST RESET
    case 0x01: return remaining >= 8 ? 8 : remaining; // READER CONFIG
    case 0x02: return remaining; // DISPLAY REQUEST is VMC-display-size dependent
    case 0x03: { // BEGIN SESSION
      size_t n = cashless.expandedCurrency ? 17 : (cashless.featureLevel >= 2 ? 10 : 3);
      return min(n, remaining);
    }
    case 0x04: return 1; // SESSION CANCEL REQUEST
    case 0x05: { // VEND APPROVED
      size_t n = cashless.expandedCurrency ? 5 : 3;
      return min(n, remaining);
    }
    case 0x06: return 1; // VEND DENIED
    case 0x07: return 1; // END SESSION
    case 0x08: return 1; // CANCELLED
    case 0x09: { // PERIPHERAL ID
      size_t n = cashless.featureLevel >= 3 ? 34 : 30;
      return min(n, remaining);
    }
    case 0x0A: return min(static_cast<size_t>(2), remaining); // MALFUNCTION
    case 0x0B: { // COMMAND OUT OF SEQUENCE
      size_t n = cashless.featureLevel >= 2 ? 2 : 1;
      return min(n, remaining);
    }
    case 0x0D: return 1; // REVALUE APPROVED
    case 0x0E: return 1; // REVALUE DENIED
    case 0x0F: { // REVALUE LIMIT AMOUNT
      size_t n = cashless.expandedCurrency ? 5 : 3;
      return min(n, remaining);
    }
    case 0x11: return 1; // TIME/DATE REQUEST
    case 0x12: return min(static_cast<size_t>(2), remaining); // DATA ENTRY REQUEST
    case 0x13: return 1; // DATA ENTRY CANCEL
    case 0x14: { // SELECTION REQUEST
      size_t n = cashless.expandedCurrency ? 23 : 16;
      return min(n, remaining);
    }
    default:
      // Unknown/variable response: consume the remainder so payload bytes are
      // never guessed as independent response codes.
      return remaining;
  }
}

void mdbHandleSlaveMessage(int cashlessIdx, const MdbWord* data, size_t dataCount) {
  if (cashlessIdx < 0 || cashlessIdx > 1 || dataCount == 0) return;
  MdbCashlessState& cashless = mdbCashless[cashlessIdx];
  uint8_t response = data[0].value;

  switch (response) {
    case 0x00: // JUST RESET
      cashless.vendPending = false;
      cashless.vendApproved = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      cashless.enabledFeatureBits = 0;
      cashless.expandedCurrency = false;
      break;

    case 0x01: // READER CONFIGURATION DATA
      // Z1=01, Z2=feature level, Z3/Z4=country, Z5=scale, Z6=decimal...
      if (dataCount >= 8) {
        cashless.featureLevel = data[1].value ? data[1].value : 1;
        uint8_t scale = data[4].value;
        uint8_t decimals = data[5].value;
        if (scale != 0 && decimals <= 4) {
          cashless.scaleFactor = scale;
          cashless.decimalPlaces = decimals;
          cashless.scaleKnown = true;
          updateMdbProfileFingerprint();
        }
      }
      break;

    case 0x05: { // VEND APPROVED
      // Standard amount is 16-bit. Level-3 expanded currency uses 32-bit,
      // as negotiated by the VMC's ENABLE OPTIONS command.
      size_t amountBytes = cashless.expandedCurrency ? 4 : 2;
      if (dataCount >= amountBytes + 1) {
        cashless.approvedScaledPrice = mdbReadBigEndian(data, 1, amountBytes);
      }
      cashless.vendApproved = true;
      break;
    }

    case 0x06: // VEND DENIED
      cashless.vendApproved = false;
      cashless.vendPending = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      break;

    case 0x07: // END SESSION
    case 0x08: // CANCELLED
      cashless.vendPending = false;
      cashless.vendApproved = false;
      cashless.selection = 0xFFFF;
      cashless.requestedScaledPrice = 0;
      cashless.approvedScaledPrice = 0;
      break;

    case 0x09: // PERIPHERAL ID
      if (dataCount >= 30) {
        // Standard cashless peripheral ID payload:
        // manufacturer[3], serial[12], model[12], software[2], then optional
        // Level-3 feature bits. This is reader/profile evidence, not a guaranteed
        // vending-machine chassis/controller serial.
        mdbCopyAsciiField(data, 1, 3, cashless.manufacturer, sizeof(cashless.manufacturer));
        mdbCopyAsciiField(data, 4, 12, cashless.peripheralSerial, sizeof(cashless.peripheralSerial));
        mdbCopyAsciiField(data, 16, 12, cashless.modelNumber, sizeof(cashless.modelNumber));
        mdbCopyAsciiField(data, 28, 2, cashless.softwareVersion, sizeof(cashless.softwareVersion));
        cashless.peripheralIdKnown = true;
      }
      if (cashless.featureLevel >= 3 && dataCount >= 34) {
        cashless.supportedFeatureBits = mdbReadBigEndian(data, 30, 4);
      }
      updateMdbProfileFingerprint();
      break;

    case 0x0A: // MALFUNCTION / ERROR
      if (dataCount >= 2) mdbSetCashlessError(cashlessIdx, data[1].value);
      break;

    case 0x0B: // COMMAND OUT OF SEQUENCE
      mdbSetOutOfSequence(cashlessIdx, dataCount >= 2 ? data[1].value : 0);
      break;

    default:
      // Other cashless responses are valid MDB but do not change the telemetry
      // counters currently stored by DallmayrERP.
      break;
  }
}

void mdbHandleSlaveData(int cashlessIdx, const MdbWord* data, size_t dataCount) {
  if (cashlessIdx < 0 || cashlessIdx > 1 || !data || dataCount == 0) return;

  // MDB explicitly permits multiple cashless responses in one checksum block.
  // Walk all response messages whose lengths are unambiguous so a VEND DENIED
  // followed by MALFUNCTION, for example, does not hide the machine fault.
  size_t offset = 0;
  while (offset < dataCount) {
    MdbCashlessState& cashless = mdbCashless[cashlessIdx];
    size_t remaining = dataCount - offset;
    size_t messageLength = mdbCashlessMessageLength(cashless, &data[offset], remaining);
    if (messageLength == 0 || messageLength > remaining) messageLength = remaining;

    mdbHandleSlaveMessage(cashlessIdx, &data[offset], messageLength);
    offset += messageLength;
  }
}

void mdbProcessMasterWords(const MdbWord* words, size_t count) {
  size_t i = 0;
  while (i < count) {
    if (!words[i].mode) {
      // Master ACK/NAK/RET outside a command block. It is valid bus traffic,
      // but not telemetry content by itself.
      ++i;
      continue;
    }

    size_t segmentEnd = i + 1;
    while (segmentEnd + 1 < count &&
           !words[segmentEnd + 1].mode &&
           segmentEnd + 1 <= i + 35) {
      ++segmentEnd;
    }

    size_t checksumIndex = 0;
    if (!mdbMasterSegmentChecksumValid(words, i, segmentEnd, checksumIndex)) {
      mdbInvalidMasterBlocks++;
      mdbChecksumErrors++;
      rejectedMachineRecords++;
      i = segmentEnd + 1;
      continue;
    }

    mdbValidMasterBlocks++;
    lastMdbValidMasterMs = millis();
    lastMachineByteMs = lastMdbValidMasterMs;
    acceptedMachineRecords++;
    mdbHandleMasterBlock(&words[i], checksumIndex - i + 1);
    i = segmentEnd + 1;
  }
}

void mdbProcessSlaveWords(const MdbWord* words, size_t count) {
  MdbWord data[36];
  size_t dataCount = 0;
  uint8_t sum = 0;

  for (size_t i = 0; i < count; ++i) {
    if (!words[i].mode) {
      if (dataCount < 35) data[dataCount++] = words[i];
      sum = static_cast<uint8_t>(sum + words[i].value);
      continue;
    }

    // Associate a peripheral response only with a very recent checksum-valid
    // Master command. MDB peripherals respond in milliseconds; this prevents
    // stale state from misclassifying unrelated traffic after capture loss.
    bool contextFresh = mdbLastMaster.atMs != 0 &&
                        (millis() - mdbLastMaster.atMs) <= MDB_RESPONSE_CONTEXT_MAX_MS;
    int cashlessIdx = contextFresh
                    ? mdbCashlessIndexForAddress(mdbLastMaster.address)
                    : -1;

    if (dataCount == 0) {
      // Single byte with mode=1 is ACK/NAK style response.
      mdbValidSlaveBlocks++;
      lastMdbValidSlaveMs = millis();
      if (cashlessIdx >= 0 && words[i].value == 0x00 &&
          mdbLastMaster.command == 2) { // ACK to POLL
        mdbClearCashlessError(cashlessIdx, "MDB cashless reader returned to normal polling");
        mdbClearOutOfSequence(cashlessIdx);
      }
    } else if (words[i].value == sum) {
      mdbValidSlaveBlocks++;
      lastMdbValidSlaveMs = millis();
      if (cashlessIdx >= 0) mdbHandleSlaveData(cashlessIdx, data, dataCount);
    } else {
      mdbInvalidSlaveBlocks++;
      mdbChecksumErrors++;
      rejectedMachineRecords++;
    }

    dataCount = 0;
    sum = 0;
  }

  // A capture ending without a mode-set final byte is incomplete by MDB rules.
  if (dataCount) {
    mdbInvalidSlaveBlocks++;
    rejectedMachineRecords++;
  }
}

bool mdbRawFramesSame(const MdbRawDebugFrame& a, const MdbRawDebugFrame& b) {
  if (a.masterDirection != b.masterDirection || a.count != b.count || a.modeMask != b.modeMask) return false;
  for (uint8_t i = 0; i < a.count; ++i) {
    if (a.values[i] != b.values[i]) return false;
  }
  return true;
}

void mdbEnqueueRawDebugFrame(const MdbRawDebugFrame& frame) {
  if (!mdbRawDebugQueue) return;
  if (xQueueSend(mdbRawDebugQueue, &frame, 0) != pdTRUE) {
    mdbRawDebugQueueDrops++;
  }
}

void mdbFlushPendingRawRepeats(bool masterDirection) {
  MdbRawDebugFrame& last = masterDirection ? mdbLastRawMaster : mdbLastRawSlave;
  bool haveLast = masterDirection ? mdbHaveLastRawMaster : mdbHaveLastRawSlave;
  uint16_t& pending = masterDirection ? mdbPendingRawMasterRepeats : mdbPendingRawSlaveRepeats;
  uint32_t& lastFlushMs = masterDirection ? mdbLastRawMasterFlushMs : mdbLastRawSlaveFlushMs;

  if (!haveLast || pending == 0) return;
  MdbRawDebugFrame summary = last;
  summary.repeatCount = pending;
  summary.diagnosticSample = false;
  mdbEnqueueRawDebugFrame(summary);
  pending = 0;
  lastFlushMs = millis();
}

void mdbQueueRawDebugFrame(MdbRawDebugFrame frame) {
  MdbRawDebugFrame& last = frame.masterDirection ? mdbLastRawMaster : mdbLastRawSlave;
  bool& haveLast = frame.masterDirection ? mdbHaveLastRawMaster : mdbHaveLastRawSlave;
  uint16_t& pending = frame.masterDirection ? mdbPendingRawMasterRepeats : mdbPendingRawSlaveRepeats;
  uint32_t& lastFlushMs = frame.masterDirection ? mdbLastRawMasterFlushMs : mdbLastRawSlaveFlushMs;

  uint32_t now = millis();
  if (!haveLast) {
    frame.repeatCount = 1;
    mdbEnqueueRawDebugFrame(frame);
    last = frame;
    last.diagnosticSample = false;
    last.repeatCount = 1;
    haveLast = true;
    pending = 0;
    lastFlushMs = now;
    return;
  }

  if (mdbRawFramesSame(last, frame)) {
    pending++;
    bool dueByCount = pending >= MDB_RAW_REPEAT_FLUSH_COUNT;
    bool dueByTime = now - lastFlushMs >= MDB_RAW_REPEAT_FLUSH_MS;
    if (frame.diagnosticSample || dueByCount || dueByTime) {
      MdbRawDebugFrame summary = frame;
      summary.repeatCount = pending;
      mdbEnqueueRawDebugFrame(summary);
      pending = 0;
      lastFlushMs = now;
    }
    return;
  }

  mdbFlushPendingRawRepeats(frame.masterDirection);
  frame.repeatCount = 1;
  mdbEnqueueRawDebugFrame(frame);
  last = frame;
  last.diagnosticSample = false;
  last.repeatCount = 1;
  haveLast = true;
  pending = 0;
  lastFlushMs = now;
}

void mdbPopulateRawDiagnostics(MdbRawDebugFrame& frame,
                               const rmt_data_t* symbols,
                               size_t symbolCount) {
  if (!symbols || symbolCount == 0) return;

  MdbWord normalWords[MDB_MAX_WORDS_PER_CAPTURE];
  MdbWord invertedWords[MDB_MAX_WORDS_PER_CAPTURE];
  uint32_t normalFraming = 0;
  uint32_t invertedFraming = 0;

  size_t normalCount = mdbDecodeRmtWords(symbols, symbolCount, false,
                                         normalWords, MDB_MAX_WORDS_PER_CAPTURE,
                                         normalFraming);
  size_t invertedCount = mdbDecodeRmtWords(symbols, symbolCount, true,
                                           invertedWords, MDB_MAX_WORDS_PER_CAPTURE,
                                           invertedFraming);

  frame.normalCount = static_cast<uint8_t>(min(normalCount, static_cast<size_t>(12)));
  frame.invertedCount = static_cast<uint8_t>(min(invertedCount, static_cast<size_t>(12)));
  frame.normalScore = frame.masterDirection
                    ? mdbScoreMasterWords(normalWords, normalCount)
                    : mdbScoreSlaveWords(normalWords, normalCount);
  frame.invertedScore = frame.masterDirection
                      ? mdbScoreMasterWords(invertedWords, invertedCount)
                      : mdbScoreSlaveWords(invertedWords, invertedCount);

  for (uint8_t i = 0; i < frame.normalCount; ++i) {
    frame.normalValues[i] = normalWords[i].value;
    if (normalWords[i].mode) frame.normalModeMask |= (1U << i);
  }
  for (uint8_t i = 0; i < frame.invertedCount; ++i) {
    frame.invertedValues[i] = invertedWords[i].value;
    if (invertedWords[i].mode) frame.invertedModeMask |= (1U << i);
  }

  for (size_t i = 0; i < symbolCount && frame.pulseCount < 16; ++i) {
    if (symbols[i].duration0 && frame.pulseCount < 16) {
      frame.pulseLevels[frame.pulseCount] = symbols[i].level0 ? 1 : 0;
      frame.pulseDurationsUs[frame.pulseCount] = symbols[i].duration0;
      frame.pulseCount++;
    }
    if (symbols[i].duration1 && frame.pulseCount < 16) {
      frame.pulseLevels[frame.pulseCount] = symbols[i].level1 ? 1 : 0;
      frame.pulseDurationsUs[frame.pulseCount] = symbols[i].duration1;
      frame.pulseCount++;
    }
  }
}

void mdbProcessCapture(const rmt_data_t* symbols,
                       size_t symbolCount,
                       bool masterDirection,
                       int8_t& learnedInvert) {
  if (!symbols || symbolCount == 0) return;
  MdbWord words[MDB_MAX_WORDS_PER_CAPTURE];
  size_t wordCount = mdbDecodeWithPolarity(symbols, symbolCount, masterDirection,
                                           learnedInvert, words, MDB_MAX_WORDS_PER_CAPTURE);
  bool rawDebugEnabled = remoteDebugActive && remoteDebugRawMdb && mdbRawDebugQueue;
  if (!wordCount && !rawDebugEnabled) return;
  if (wordCount) mdbDecodedWords += wordCount;

  if (rawDebugEnabled) {
    MdbRawDebugFrame frame = {};
    frame.masterDirection = masterDirection;
    frame.count = static_cast<uint8_t>(min(wordCount, static_cast<size_t>(24)));
    frame.atMs = millis();
    for (uint8_t i = 0; i < frame.count; ++i) {
      frame.values[i] = words[i].value;
      if (words[i].mode) frame.modeMask |= (1UL << i);
    }

    uint32_t now = millis();
    uint32_t& lastDiagMs = masterDirection ? mdbLastMasterDiagMs : mdbLastSlaveDiagMs;
    bool unusualCapture = frame.count != 1;
    bool periodicSampleDue = lastDiagMs == 0 || now - lastDiagMs >= MDB_RAW_DIAG_SAMPLE_MS;
    frame.diagnosticSample = unusualCapture || periodicSampleDue;
    if (frame.diagnosticSample) {
      mdbPopulateRawDiagnostics(frame, symbols, symbolCount);
      lastDiagMs = now;
    }

    mdbQueueRawDebugFrame(frame);
  }

  if (!wordCount) return;
  if (masterDirection) mdbProcessMasterWords(words, wordCount);
  else mdbProcessSlaveWords(words, wordCount);
}

bool mdbArmMasterCapture() {
  mdbMasterRmtCount = MDB_RMT_SYMBOL_CAPACITY;
  mdbMasterReadArmed = rmtReadAsync(MDB_VMC_TX_MONITOR_PIN, mdbMasterRmt, &mdbMasterRmtCount);
  return mdbMasterReadArmed;
}

bool mdbArmSlaveCapture() {
  mdbSlaveRmtCount = MDB_RMT_SYMBOL_CAPACITY;
  mdbSlaveReadArmed = rmtReadAsync(MDB_VMC_RX_MONITOR_PIN, mdbSlaveRmt, &mdbSlaveRmtCount);
  return mdbSlaveReadArmed;
}

void mdbCaptureTask(void* parameter) {
  (void)parameter;

  while (mdbCaptureTaskRun) {
    bool didWork = false;

    if (!mdbMasterReadArmed) {
      mdbMasterReadArmed = mdbArmMasterCapture();
      mdbMasterCaptureFault = !mdbMasterReadArmed;
      didWork = true;
    } else if (rmtReceiveCompleted(MDB_VMC_TX_MONITOR_PIN)) {
      mdbMasterReadArmed = false;
      size_t received = mdbMasterRmtCount;
      if (received > 0 && received <= MDB_RMT_SYMBOL_CAPACITY) {
        mdbProcessCapture(mdbMasterRmt, received, true, mdbMasterInvert);
      }
      // Re-arm immediately in the dedicated task. Network operations in the
      // Arduino loop therefore cannot create multi-second MDB blind spots.
      mdbMasterReadArmed = mdbArmMasterCapture();
      mdbMasterCaptureFault = !mdbMasterReadArmed;
      didWork = true;
    }

    if (!mdbSlaveReadArmed) {
      mdbSlaveReadArmed = mdbArmSlaveCapture();
      mdbSlaveCaptureFault = !mdbSlaveReadArmed;
      didWork = true;
    } else if (rmtReceiveCompleted(MDB_VMC_RX_MONITOR_PIN)) {
      mdbSlaveReadArmed = false;
      size_t received = mdbSlaveRmtCount;
      if (received > 0 && received <= MDB_RMT_SYMBOL_CAPACITY) {
        mdbProcessCapture(mdbSlaveRmt, received, false, mdbSlaveInvert);
      }
      mdbSlaveReadArmed = mdbArmSlaveCapture();
      mdbSlaveCaptureFault = !mdbSlaveReadArmed;
      didWork = true;
    }

    // Always block for at least one RTOS tick. RMT remains armed in hardware
    // during this delay. taskYIELD() only yields to equal/higher-priority tasks;
    // with continuous MDB traffic the former priority-4 task could starve the
    // lower-priority Arduino loop indefinitely.
    vTaskDelay(pdMS_TO_TICKS(1));
  }

  mdbCaptureTaskHandle = nullptr;
  vTaskDelete(nullptr);
}

void stopMdbCapture() {
  if (mdbCaptureTaskHandle) {
    mdbCaptureTaskRun = false;
    // The task normally exits within a few scheduler ticks. Do not deinitialize
    // RMT while the capture task is still inside an RMT call.
    uint32_t started = millis();
    while (mdbCaptureTaskHandle && millis() - started < 250UL) {
      vTaskDelay(pdMS_TO_TICKS(2));
    }
    if (mdbCaptureTaskHandle) {
      vTaskDelete(mdbCaptureTaskHandle);
      mdbCaptureTaskHandle = nullptr;
    }
  }

  if (mdbRmtReady) {
    rmtDeinit(MDB_VMC_TX_MONITOR_PIN);
    rmtDeinit(MDB_VMC_RX_MONITOR_PIN);
  }

  mdbRmtReady = false;
  mdbMasterReadArmed = false;
  mdbSlaveReadArmed = false;
  mdbMasterCaptureFault = false;
  mdbSlaveCaptureFault = false;

  if (mdbEventQueue) {
    vQueueDelete(mdbEventQueue);
    mdbEventQueue = nullptr;
    if (mdbRawDebugQueue) {
      vQueueDelete(mdbRawDebugQueue);
      mdbRawDebugQueue = nullptr;
    }
  }

  pinMode(MDB_VMC_TX_MONITOR_PIN, INPUT);
  pinMode(MDB_VMC_RX_MONITOR_PIN, INPUT);
}

bool beginMdbCapture() {
  stopMdbCapture();

  pinMode(MDB_VMC_TX_MONITOR_PIN, INPUT);
  pinMode(MDB_VMC_RX_MONITOR_PIN, INPUT);

  mdbEventQueue = xQueueCreate(96, sizeof(MdbTelemetryEvent));
  if (!mdbEventQueue) {
    Serial.println(F("FATAL: could not allocate MDB telemetry event queue."));
    return false;
  }
  mdbRawDebugQueue = xQueueCreate(48, sizeof(MdbRawDebugFrame));
  if (!mdbRawDebugQueue) {
    Serial.println(F("Remote MDB raw-frame queue unavailable; production MDB decoding will continue."));
  }

  bool masterOk = rmtInit(MDB_VMC_TX_MONITOR_PIN, RMT_RX_MODE,
                          RMT_MEM_NUM_BLOCKS_2, MDB_RMT_HZ);
  bool slaveOk = rmtInit(MDB_VMC_RX_MONITOR_PIN, RMT_RX_MODE,
                         RMT_MEM_NUM_BLOCKS_2, MDB_RMT_HZ);
  if (!masterOk || !slaveOk) {
    Serial.println(F("FATAL: could not allocate both MDB RMT RX channels."));
    if (masterOk) rmtDeinit(MDB_VMC_TX_MONITOR_PIN);
    if (slaveOk) rmtDeinit(MDB_VMC_RX_MONITOR_PIN);
    vQueueDelete(mdbEventQueue);
    mdbEventQueue = nullptr;
    if (mdbRawDebugQueue) {
      vQueueDelete(mdbRawDebugQueue);
      mdbRawDebugQueue = nullptr;
    }
    return false;
  }

  bool thresholdsOk =
      rmtSetRxMinThreshold(MDB_VMC_TX_MONITOR_PIN, MDB_NOISE_FILTER_TICKS) &&
      rmtSetRxMinThreshold(MDB_VMC_RX_MONITOR_PIN, MDB_NOISE_FILTER_TICKS) &&
      rmtSetRxMaxThreshold(MDB_VMC_TX_MONITOR_PIN, MDB_RX_IDLE_US) &&
      rmtSetRxMaxThreshold(MDB_VMC_RX_MONITOR_PIN, MDB_RX_IDLE_US);
  if (!thresholdsOk) {
    Serial.println(F("FATAL: could not configure MDB RMT receive thresholds."));
    rmtDeinit(MDB_VMC_TX_MONITOR_PIN);
    rmtDeinit(MDB_VMC_RX_MONITOR_PIN);
    vQueueDelete(mdbEventQueue);
    mdbEventQueue = nullptr;
    if (mdbRawDebugQueue) {
      vQueueDelete(mdbRawDebugQueue);
      mdbRawDebugQueue = nullptr;
    }
    return false;
  }

  mdbRmtReady = true;
  mdbStartedMs = millis();
  lastMdbValidMasterMs = 0;
  lastMdbValidSlaveMs = 0;
  mdbMasterInvert = -1;
  mdbSlaveInvert = -1;
  applyConfiguredMdbPolarity(false, true);
  mdbEventQueueOverflows = 0;
  mdbMasterCaptureFault = false;
  mdbSlaveCaptureFault = false;
  mdbHaveLastRawMaster = false;
  mdbHaveLastRawSlave = false;
  mdbPendingRawMasterRepeats = 0;
  mdbPendingRawSlaveRepeats = 0;
  mdbLastRawMasterFlushMs = 0;
  mdbLastRawSlaveFlushMs = 0;
  mdbLastMasterDiagMs = 0;
  mdbLastSlaveDiagMs = 0;

  mdbMasterReadArmed = mdbArmMasterCapture();
  mdbSlaveReadArmed = mdbArmSlaveCapture();
  if (!mdbMasterReadArmed || !mdbSlaveReadArmed) {
    Serial.println(F("FATAL: MDB RMT channels initialized but capture could not be armed."));
    stopMdbCapture();
    return false;
  }

  mdbCaptureTaskRun = true;
#if CONFIG_FREERTOS_UNICORE
  BaseType_t taskOk = xTaskCreate(mdbCaptureTask, "mdb_capture", 8192, nullptr, 1,
                                  &mdbCaptureTaskHandle);
#else
  // RMT captures independently in hardware, so this worker does not need to
  // outrank Arduino loop(). Priority 1 plus an unconditional 1-tick sleep keeps
  // continuous MDB activity from starving cellular/config/heartbeat services.
  BaseType_t taskOk = xTaskCreatePinnedToCore(mdbCaptureTask, "mdb_capture", 8192,
                                             nullptr, 1, &mdbCaptureTaskHandle, 1);
#endif
  if (taskOk != pdPASS) {
    mdbCaptureTaskRun = false;
    mdbCaptureTaskHandle = nullptr;
    Serial.println(F("FATAL: could not start dedicated MDB capture task."));
    stopMdbCapture();
    return false;
  }

  Serial.print(F("Native passive MDB decoder active: GREEN/Master-TX -> GPIO"));
  Serial.print(MDB_VMC_TX_MONITOR_PIN);
  Serial.print(F(", YELLOW/Master-RX -> GPIO"));
  Serial.println(MDB_VMC_RX_MONITOR_PIN);
  Serial.println(F("MDB capture runs in a dedicated FreeRTOS task; both GPIOs remain INPUT-ONLY."));
  return true;
}

void beginMdbPins() {
  // Safe fallback state used whenever native MDB capture is stopped.
  stopMdbCapture();
}

void processMdb() {
  if (!mdbRmtReady) return;

  // Convert capture-task events into the existing telemetry/counter model on
  // the Arduino application task. This keeps Preferences/String/network work
  // out of the timing-sensitive MDB capture task.
  serviceMdbRawDebugEvents();
  serviceMdbTelemetryEvents();

  if (mdbMasterCaptureFault) {
    setLocalFaultState("MDB_CAPTURE_MASTER", true, "fault", "mdb",
                       "Failed to arm MDB Master-TX RMT capture", "");
  } else {
    LocalFault* existing = findFault("MDB_CAPTURE_MASTER");
    if (existing && existing->active) {
      setLocalFaultState("MDB_CAPTURE_MASTER", false, "info", "mdb",
                         "MDB Master-TX capture restored", "");
    }
  }

  if (mdbSlaveCaptureFault) {
    setLocalFaultState("MDB_CAPTURE_SLAVE", true, "fault", "mdb",
                       "Failed to arm MDB Master-RX RMT capture", "");
  } else {
    LocalFault* existing = findFault("MDB_CAPTURE_SLAVE");
    if (existing && existing->active) {
      setLocalFaultState("MDB_CAPTURE_SLAVE", false, "info", "mdb",
                         "MDB Master-RX capture restored", "");
    }
  }

  if (mdbEventQueueOverflows != 0) {
    setLocalFaultState("MDB_EVENT_QUEUE_OVERFLOW", true, "warning", "mdb",
                       "MDB event queue overflowed; telemetry events may have been dropped", "");
  }

  // A healthy MDB VMC polls peripherals frequently. No valid Master traffic for
  // a full minute is treated as a telemetry-link fault, not as a machine fault.
  uint32_t now = millis();
  bool graceExpired = mdbStartedMs && now - mdbStartedMs >= MDB_SIGNAL_LOSS_MS;
  bool masterSilent = lastMdbValidMasterMs == 0
                    ? graceExpired
                    : now - lastMdbValidMasterMs >= MDB_SIGNAL_LOSS_MS;
  if (graceExpired && masterSilent) {
    setLocalFaultState("MDB_NO_VALID_TRAFFIC", true, "warning", "mdb",
                       "No checksum-valid MDB Master traffic detected for 60 seconds", "");
  } else if (graceExpired) {
    LocalFault* existing = findFault("MDB_NO_VALID_TRAFFIC");
    if (existing && existing->active) {
      setLocalFaultState("MDB_NO_VALID_TRAFFIC", false, "info", "mdb",
                         "Checksum-valid MDB Master traffic restored", "");
    }
  }
}

// -----------------------------------------------------------------------------
// Machine interface control
// -----------------------------------------------------------------------------

void restartMachineInterface() {
  DexSerial.end();
  normalizedLine = "";
  normalizedLineOverflow = false;
  beginMdbPins();
  delay(20);

  if (machineInterface == IFACE_DEX || machineInterface == IFACE_NORMALIZED_UART) {
    DexSerial.begin(dexBaud, SERIAL_8N1, DEX_RX_PIN, DEX_TX_PIN);
    Serial.print(F("Machine UART started on DEX pins at "));
    Serial.print(dexBaud);
    Serial.print(F(" baud, mode="));
    Serial.println(interfaceName(machineInterface));
  } else if (machineInterface == IFACE_MDB) {
    if (!beginMdbCapture()) {
      Serial.println(F("MDB native decoder failed to start; interface moved to DISABLED."));
      machineInterface = IFACE_DISABLED;
      saveCoreSettings();
    }
  } else if (machineInterface == IFACE_DISABLED) {
    Serial.println(F("Machine interface disabled; MDB pins are high impedance."));
  }
}

void serviceMachineInterface() {
  switch (machineInterface) {
    case IFACE_DEX: processDexSerial(); break;
    case IFACE_NORMALIZED_UART: processNormalizedSerial(); break;
    case IFACE_MDB: processMdb(); break;
    default: break;
  }
}

// -----------------------------------------------------------------------------
// Upload orchestration
// -----------------------------------------------------------------------------


// -----------------------------------------------------------------------------
// Location upload
// -----------------------------------------------------------------------------

bool uploadLocationUpdate() {
  if (!deviceEnrolled() || !policy.locationEnabled || !anyDataTransportReady()) return false;
  bool useGnss = gnssFix.valid;
  bool useFallback = !useGnss && fallbackLocationConfigured();
  if (!useGnss && !useFallback) return false;

  JsonDocument doc;
  addCommonPayload(doc, "location_update");
  JsonObject location = doc["location"].to<JsonObject>();
  if (useGnss) {
    location["latitude"] = gnssFix.latitude;
    location["longitude"] = gnssFix.longitude;
    location["source"] = "gnss";
    if (!isnan(gnssFix.accuracyM)) location["accuracy_m"] = gnssFix.accuracyM;
    if (!isnan(gnssFix.altitudeM)) location["altitude_m"] = gnssFix.altitudeM;
    if (!isnan(gnssFix.speedMps)) location["speed_mps"] = gnssFix.speedMps;
    if (gnssFix.satellites > 0) location["satellites"] = gnssFix.satellites;
    if (!isnan(gnssFix.hdop)) location["hdop"] = gnssFix.hdop;
    if (gnssFix.utcIso[0]) location["fix_at"] = gnssFix.utcIso;
  } else {
    location["latitude"] = DALLMAYR_FALLBACK_LATITUDE;
    location["longitude"] = DALLMAYR_FALLBACK_LONGITUDE;
    location["source"] = "manual";
  }

  bool ok = sendDocumentToIngest(doc);
  if (ok) {
    lastLocationUploadMs = millis();
    policy.locationDue = false;
    Serial.print(F("Location uploaded source=")); Serial.println(useGnss ? "gnss" : "manual");
  }
  return ok;
}

void serviceLocation() {
  if (!deviceEnrolled() || !policy.locationEnabled || !anyDataTransportReady()) return;
  uint32_t intervalMinutes = policy.locationIntervalMinutes == 0 ? 15 : policy.locationIntervalMinutes;
  uint32_t intervalMs = intervalMinutes * 60000UL;
  bool due = policy.locationDue || lastLocationUploadMs == 0 || millis() - lastLocationUploadMs >= intervalMs;
  if (due) uploadLocationUpdate();
}

// -----------------------------------------------------------------------------
// Local heartbeat scheduling
// -----------------------------------------------------------------------------

void serviceHeartbeatSchedule() {
  if (!deviceEnrolled()) return;

  uint32_t intervalMinutes = policy.heartbeatIntervalMinutes == 0
    ? 1 : policy.heartbeatIntervalMinutes;
  uint32_t intervalMs = intervalMinutes * 60000UL;

  // The interval comes from the effective Supabase policy and is cached in NVS.
  // Startup still sends one immediate heartbeat so the device proves it is alive.
  if (lastHeartbeatUploadSuccessMs != 0 &&
      millis() - lastHeartbeatUploadSuccessMs >= intervalMs) {
    heartbeatUploadRequested = true;
  }
}

void serviceCounterSchedule() {
  if (!deviceEnrolled() || counterCount == 0) return;

  uint32_t intervalMinutes = policy.counterIntervalMinutes == 0
    ? 1 : policy.counterIntervalMinutes;
  uint32_t intervalMs = intervalMinutes * 60000UL;
  uint32_t anchor = lastCounterUploadSuccessMs != 0
    ? lastCounterUploadSuccessMs : counterScheduleStartMs;

  // The server can explicitly mark counters due on config fetch. Otherwise the
  // cached DB interval schedules the next snapshot locally without waiting for
  // another config request.
  if (policy.counterDue ||
      (anchor != 0 && millis() - anchor >= intervalMs)) {
    counterUploadRequested = true;
  }
}

// -----------------------------------------------------------------------------
// Production upload orchestration
// -----------------------------------------------------------------------------

void serviceUploads() {
  if (!anyDataTransportReady()) return;
  if (!gatewayCredentialReady()) return;
  uint32_t now = millis();

  // Control-plane health wins over machine-derived telemetry. A bad counter or
  // fault payload must never prevent a heartbeat from proving the unit is alive.
  if (heartbeatUploadRequested &&
      (lastHeartbeatUploadAttemptMs == 0 || now - lastHeartbeatUploadAttemptMs >= HEARTBEAT_UPLOAD_RETRY_MS)) {
    lastHeartbeatUploadAttemptMs = now;
    if (!uploadHeartbeat()) {
      Serial.println(F("Heartbeat upload failed; backing off for 30 seconds."));
    }
  }

  flushPendingFaults();

  if (counterUploadRequested &&
      (lastCounterUploadAttemptMs == 0 || now - lastCounterUploadAttemptMs >= COUNTER_UPLOAD_RETRY_MS)) {
    lastCounterUploadAttemptMs = now;
    if (machineInterface == IFACE_DEX) {
      if (!dexRequestActive) requestDexAudit();
    } else if (!uploadAllCounters()) {
      Serial.println(F("Counter upload failed; backing off for 30 seconds so config/heartbeat remain serviceable."));
    }
  }
}

// -----------------------------------------------------------------------------
// Serial console
// -----------------------------------------------------------------------------

void printWiringMap() {
  Serial.println(F("--- CONFIRMED MDB PRODUCTION WIRING ---"));
  Serial.println(F("RAW MDB WIRES MUST PASS THROUGH THE ISOLATED ELECTRICAL INTERFACE."));
  Serial.print  (F("GREEN  : MDB pin 5 / Master Transmit -> isolated receiver -> ESP32 GPIO"));
  Serial.println(MDB_VMC_TX_MONITOR_PIN);
  Serial.print  (F("YELLOW : MDB pin 4 / Master Receive  -> isolated receiver -> ESP32 GPIO"));
  Serial.println(MDB_VMC_RX_MONITOR_PIN);
  Serial.println(F("WHITE  : MDB pin 6 / Communications Common -> MACHINE SIDE of isolated interface only"));
  Serial.println(F("MDB pin 3: empty / N.C."));
  Serial.println(F("GPIO4 and GPIO5 are BOTH INPUT-ONLY in native production MDB mode."));
  Serial.println(F("Do NOT connect GREEN/YELLOW/WHITE directly to ESP32 pins."));
  Serial.print  (F("DEX TX from machine -> SP3232 R1IN/R1OUT -> ESP32 GPIO")); Serial.println(DEX_RX_PIN);
  Serial.print  (F("DEX RX to machine <- SP3232 T1OUT/T1IN <- ESP32 GPIO")); Serial.println(DEX_TX_PIN);
  Serial.print  (F("Air780 TX -> ESP32 GPIO")); Serial.print(CELL_RX_PIN); Serial.println(F(" (cellular UART)"));
  Serial.print  (F("Air780 RX <- ESP32 GPIO")); Serial.print(CELL_TX_PIN); Serial.println(F(" (cellular UART)"));
}
uint64_t totalSuccessfulCupCount() {
  uint64_t total = 0;
  for (uint16_t i = 0; i < counterCount; ++i) {
    if (counters[i].used) total += counters[i].soldTotal;
  }
  return total;
}

void printMachineIdentity() {
  Serial.println(F("--- MACHINE IDENTITY / AUTO-PROFILE EVIDENCE ---"));
  Serial.print(F("Source: ")); Serial.println(machineIdentitySource.length() ? machineIdentitySource : "<not detected>");
  Serial.print(F("Machine serial: ")); Serial.println(reportedMachineSerial.length() ? reportedMachineSerial : "<not available>");
  Serial.print(F("Model: ")); Serial.println(reportedMachineModel.length() ? reportedMachineModel : "<not available>");
  Serial.print(F("Revision: ")); Serial.println(reportedMachineRevision.length() ? reportedMachineRevision : "<not available>");
  Serial.print(F("Location field: ")); Serial.println(reportedMachineLocation.length() ? reportedMachineLocation : "<not available>");
  Serial.print(F("Asset: ")); Serial.println(reportedMachineAsset.length() ? reportedMachineAsset : "<not available>");
  Serial.print(F("Profile fingerprint: ")); Serial.println(machineProfileFingerprint.length() ? machineProfileFingerprint : "<not available>");
  Serial.print(F("Assigned DB profile: ")); Serial.println(strlen(policy.profileId) ? policy.profileId : "<not assigned>");
  if (machineIdentitySource.equalsIgnoreCase("mdb_bus_signature")) {
    Serial.println(F("NOTE: MDB signature is profile evidence only; standard MDB does not guarantee the VMC serial."));
  }
}

void printCupCounters() {
  Serial.println(F("--- SUCCESSFUL CUP COUNTERS BY SELECTION ---"));
  Serial.print(F("Reporting mode: ")); Serial.println(policy.mode);
  char value[24] = {0};
  for (uint16_t i = 0; i < counterCount; ++i) {
    CounterEntry& c = counters[i];
    if (!c.used) continue;
    Serial.print(c.selection);
    if (strlen(c.product)) {
      Serial.print(F(" / "));
      Serial.print(c.product);
    }
    snprintf(value, sizeof(value), "%llu", static_cast<unsigned long long>(c.soldTotal));
    Serial.print(F(" cups=")); Serial.print(value);
    snprintf(value, sizeof(value), "%llu", static_cast<unsigned long long>(c.failedTotal));
    Serial.print(F(" failed=")); Serial.println(value);
  }
  snprintf(value, sizeof(value), "%llu", static_cast<unsigned long long>(totalSuccessfulCupCount()));
  Serial.print(F("Total successful cups: ")); Serial.println(value);
}

void printStatus() {
  Serial.println(F("--- Dallmayr Telemetry V6.8.44 AUTO-PROFILE CUP-COUNTERS DB-POLICY NATIVE MDB + DEX ---"));
  Serial.print(F("Firmware: ")); Serial.println(FIRMWARE_VERSION);
  Serial.print(F("Device: ")); Serial.println(deviceId.length() ? deviceId : "<identity not initialized>");
  Serial.print(F("Hardware UID: ")); Serial.println(hardwareUid.length() ? hardwareUid : "<unknown>");
  Serial.print(F("Enrollment: ")); Serial.println(deviceEnrolled() ? "enrolled" : "not enrolled");
  Serial.print(F("Enrollment mode: ")); Serial.println(enrollmentToken.length() ? "one-time token fallback" : "automatic administrator window");
  Serial.print(F("Supabase gateway JWT: ")); Serial.println(supabaseAnonKey.length() ? "provisioned" : "missing");
  Serial.print(F("Simulation data test enabled: ")); Serial.println(DALLMAYR_SIM_DATA_TEST_ENABLED ? "yes" : "no");
  Serial.print(F("Automatic SIM test completed: ")); Serial.println(automaticSimulationTestCompleted ? "yes" : "no");
  Serial.print(F("Enrollment cellular-first fallback: ")); Serial.println(DALLMAYR_ZERO_TOUCH_CELL_FIRST ? "yes" : "no");
  Serial.println(F("Runtime transport: DB policy; provisioned Wi-Fi receives a 20-second primary connection window before cellular recovery."));
  Serial.print(F("Machine I/O support compiled: ")); Serial.println(DALLMAYR_MACHINE_IO_ENABLED ? "yes" : "no");
  Serial.print(F("Reported machine S/N: ")); Serial.println(reportedMachineSerial.length() ? reportedMachineSerial : "<not set>");
  Serial.print(F("Machine identity source: ")); Serial.println(machineIdentitySource.length() ? machineIdentitySource : "<not detected>");
  Serial.print(F("Machine model: ")); Serial.println(reportedMachineModel.length() ? reportedMachineModel : "<not detected>");
  Serial.print(F("Profile fingerprint: ")); Serial.println(machineProfileFingerprint.length() ? machineProfileFingerprint : "<not detected>");
  char cupTotalText[24] = {0};
  snprintf(cupTotalText, sizeof(cupTotalText), "%llu",
           static_cast<unsigned long long>(totalSuccessfulCupCount()));
  Serial.print(F("Successful cup total: ")); Serial.println(cupTotalText);
  Serial.print(F("Remote Test Center: ")); Serial.println(remoteDebugActive ? "active" : "inactive");
  if (remoteDebugActive) {
    Serial.print(F("Remote Test Center session: ")); Serial.println(remoteDebugSessionId);
    Serial.print(F("Remote raw MDB: ")); Serial.println(remoteDebugRawMdb ? "on" : "off");
    Serial.print(F("Remote raw DEX: ")); Serial.println(remoteDebugRawDex ? "on" : "off");
  }
  Serial.print(F("Interface: ")); Serial.println(interfaceName(machineInterface));
  Serial.print(F("DEX baud: ")); Serial.println(dexBaud);
  Serial.print(F("MDB native baud: ")); Serial.println(MDB_BAUD);
  Serial.print(F("MDB active TX compiled: ")); Serial.println(DALLMAYR_MDB_ACTIVE_TX_ENABLED ? "yes" : "no (passive)");
  Serial.print(F("Accepted machine records: ")); Serial.println(acceptedMachineRecords);
  Serial.print(F("Rejected machine records: ")); Serial.println(rejectedMachineRecords);
  if (lastMachineByteMs) {
    Serial.print(F("Last machine UART byte age ms: ")); Serial.println(millis() - lastMachineByteMs);
  } else {
    Serial.println(F("Last machine UART byte: none since boot"));
  }
  Serial.print(F("Wi-Fi configured: ")); Serial.println(wifiSsid.length() ? "yes" : "no");
  Serial.print(F("Wi-Fi connected: ")); Serial.println(wifiReady() ? "yes" : "no");
  Serial.print(F("Wi-Fi status code: ")); Serial.println(static_cast<int>(WiFi.status()));
  Serial.print(F("Wi-Fi begin issued: ")); Serial.println(wifiBeginIssued ? "yes" : "no");
  if (wifiReady()) {
    Serial.print(F("Wi-Fi RSSI: ")); Serial.println(WiFi.RSSI());
  }
  Serial.print(F("Cellular ready: ")); Serial.println(cellReady ? "yes" : "no");
  Serial.print(F("Cellular manual PPP started: ")); Serial.println(pppStarted ? "yes" : "no");
  Serial.print(F("Cellular manual PPP online: ")); Serial.println(pppOnline ? "yes" : "no");
  Serial.print(F("Cellular PPP phase: ")); Serial.println(airPppPhaseName(airPppPhase));
  Serial.print(F("Cellular PPP auth profile: ")); Serial.println(airPppAuthProfileName());
  Serial.print(F("Cellular PPP auth profiles exhausted: ")); Serial.println(airPppAuthProfileExhausted ? "yes" : "no");
  if (pppOnline) { Serial.print(F("Cellular manual PPP IP: ")); Serial.println(airPppIpText()); }
  Serial.print(F("Cellular CSQ cached: ")); Serial.println(cellularCsq);
  Serial.print(F("Cellular model: ")); Serial.println(cellularModel.length() ? cellularModel : "<unknown>");
  Serial.print(F("Cellular firmware: ")); Serial.println(cellularFirmware.length() ? cellularFirmware : "<unknown>");
  Serial.print(F("Cellular operator: ")); Serial.println(cellularOperator.length() ? cellularOperator : "<unknown>");
  Serial.print(F("APN: ")); Serial.println(apn.length() ? apn : "<automatic>");
  char usageBuffer[24] = {0};
  snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationTxBytes));
  Serial.print(F("Cellular application TX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationRxBytes));
  Serial.print(F("Cellular application RX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  if (cellularModemUsageAvailable) {
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularModemTxBytes));
    Serial.print(F("Air780E network TX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularModemRxBytes));
    Serial.print(F("Air780E network RX: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  }
  snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(wifiApplicationTxBytes + wifiApplicationRxBytes));
  Serial.print(F("Wi-Fi application total: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  Serial.println(F("Usage counters exclude TLS/TCP/IP/radio overhead; Vodacom billing is authoritative."));
  Serial.print(F("Vodacom prepaid balance status: ")); Serial.println(prepaidBalanceStatus);
  if (prepaidBalanceStatus == "unsupported_modem_firmware") {
    Serial.println(F("Vodacom live balance requires external self-service; Air780EU V1180 USSD is unsupported."));
  }
  Serial.print(F("Vodacom prepaid balance code: ")); Serial.println(policy.prepaidBalanceUssdCode);
  if (prepaidBalanceAvailable) {
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(prepaidBalanceRemainingBytes));
    Serial.print(F("Vodacom prepaid data remaining: ")); Serial.print(usageBuffer); Serial.println(F(" B"));
  }
  Serial.print(F("Vodacom prepaid check interval: "));
  Serial.print(policy.prepaidBalanceCheckIntervalMinutes); Serial.println(F(" minute(s)"));
  if (prepaidBalanceText.length()) {
    Serial.print(F("Last Vodacom balance response: ")); Serial.println(prepaidBalanceText);
  }
  if (prepaidBalanceError.length()) {
    Serial.print(F("Last Vodacom balance error: ")); Serial.println(prepaidBalanceError);
  }
  Serial.print(F("Remote transport preference: ")); Serial.println(policy.transportPreference);
  Serial.print(F("Remote Wi-Fi enabled: ")); Serial.println(policy.wifiEnabled ? "yes" : "no");
  Serial.print(F("Remote cellular enabled: ")); Serial.println(policy.cellularEnabled ? "yes" : "no");
  Serial.print(F("Remote location enabled: ")); Serial.println(policy.locationEnabled ? "yes" : "no");
  Serial.print(F("Location interval min: ")); Serial.println(policy.locationIntervalMinutes);
  Serial.print(F("Movement threshold m: ")); Serial.println(policy.locationMinMoveM);
  Serial.print(F("GNSS configured: ")); Serial.println(DALLMAYR_GNSS_ENABLED ? "yes" : "no");
  Serial.print(F("GNSS valid fix: ")); Serial.println(gnssFix.valid ? "yes" : "no");
  if (gnssFix.valid) {
    Serial.print(F("GNSS lat/lng: ")); Serial.print(gnssFix.latitude, 6); Serial.print(F(", ")); Serial.println(gnssFix.longitude, 6);
    Serial.print(F("GNSS satellites: ")); Serial.println(gnssFix.satellites);
  }
  Serial.print(F("Policy: ")); Serial.print(policy.mode);
  Serial.print(F(" code=")); Serial.print(policy.policyCode);
  Serial.print(F(" source=")); Serial.println(policy.source);
  Serial.print(F("Policy updated at: ")); Serial.println(strlen(policy.policyUpdatedAt) ? policy.policyUpdatedAt : "<cached/no revision>");
  Serial.print(F("Profile: ")); Serial.println(policy.profileId);
  Serial.print(F("Counters: ")); Serial.println(counterCount);
  Serial.print(F("DB heartbeat interval: ")); Serial.print(policy.heartbeatIntervalMinutes); Serial.println(F(" minute(s)"));
  Serial.print(F("DB counter interval: ")); Serial.print(policy.counterIntervalMinutes); Serial.println(F(" minute(s)"));
  Serial.print(F("DB config refresh interval: ")); Serial.print(policy.configRefreshMinutes); Serial.println(F(" minute(s)"));
  Serial.print(F("Config ACK pending: ")); Serial.println(configAckPending ? "yes" : "no");
  Serial.print(F("Transport commit pending: ")); Serial.print(transportTransitionPending ? "yes" : "no");
  if (transportTransitionPending) { Serial.print(F(" via ")); Serial.print(transportTransitionSource); }
  Serial.println();
  Serial.print(F("Upload retry guard: heartbeat/fault/counter = "));
  Serial.print(HEARTBEAT_UPLOAD_RETRY_MS / 1000UL); Serial.print(F("/"));
  Serial.print(FAULT_UPLOAD_RETRY_MS / 1000UL); Serial.print(F("/"));
  Serial.print(COUNTER_UPLOAD_RETRY_MS / 1000UL); Serial.println(F(" sec"));
  Serial.print(F("Counter epoch: ")); Serial.println(counterEpoch);
  if (machineInterface == IFACE_MDB) {
    Serial.print(F("MDB RMT ready: ")); Serial.println(mdbRmtReady ? "yes" : "no");
    Serial.print(F("MDB valid master blocks: ")); Serial.println(mdbValidMasterBlocks);
    Serial.print(F("MDB valid slave blocks: ")); Serial.println(mdbValidSlaveBlocks);
    Serial.print(F("MDB invalid master blocks: ")); Serial.println(mdbInvalidMasterBlocks);
    Serial.print(F("MDB invalid slave blocks: ")); Serial.println(mdbInvalidSlaveBlocks);
    Serial.print(F("MDB checksum errors: ")); Serial.println(mdbChecksumErrors);
    Serial.print(F("MDB framing errors: ")); Serial.println(mdbFramingErrors);
    Serial.print(F("MDB decoded words: ")); Serial.println(mdbDecodedWords);
    Serial.print(F("MDB capture task: ")); Serial.println(mdbCaptureTaskHandle ? "running" : "stopped");
    Serial.print(F("MDB event queue overflows: ")); Serial.println(mdbEventQueueOverflows);
    Serial.print(F("MDB GPIO4/master-TX polarity configured: "));
    Serial.println(policy.mdbMasterPolarity);
    Serial.print(F("MDB GPIO4/master-TX polarity effective: "));
    Serial.println(mdbMasterInvert < 0 ? "learning" : (mdbMasterInvert ? "inverted" : "normal"));
    Serial.print(F("MDB GPIO5/master-RX polarity configured: "));
    Serial.println(policy.mdbSlavePolarity);
    Serial.print(F("MDB GPIO5/master-RX polarity effective: "));
    Serial.println(mdbSlaveInvert < 0 ? "learning" : (mdbSlaveInvert ? "inverted" : "normal"));
    Serial.println(F("MDB RMT idle-tail reconstruction: enabled (1 logical idle bit per completed capture)"));
    Serial.print(F("MDB Test Center dual-decode sample interval: "));
    Serial.print(MDB_RAW_DIAG_SAMPLE_MS / 1000UL);
    Serial.println(F(" second(s)"));
    Serial.print(F("MDB raw repeat aggregation: "));
    Serial.print(MDB_RAW_REPEAT_FLUSH_COUNT);
    Serial.print(F(" frames or "));
    Serial.print(MDB_RAW_REPEAT_FLUSH_MS / 1000UL);
    Serial.println(F(" second(s)"));
    for (int i = 0; i < 2; ++i) {
      Serial.print(F("Cashless ")); Serial.print(i + 1);
      Serial.print(F(" level=")); Serial.print(mdbCashless[i].featureLevel);
      Serial.print(F(" factor=")); Serial.print(mdbCashless[i].scaleFactor);
      Serial.print(F(" decimals=")); Serial.print(mdbCashless[i].decimalPlaces);
      Serial.print(F(" scale_learned=")); Serial.print(mdbCashless[i].scaleKnown ? "yes" : "no");
      Serial.print(F(" expanded_currency=")); Serial.print(mdbCashless[i].expandedCurrency ? "yes" : "no");
      Serial.print(F(" enabled_features=0x")); Serial.println(mdbCashless[i].enabledFeatureBits, HEX);
    }
  } else if (machineInterface == IFACE_DISABLED) {
    Serial.println(F("Machine status: disabled. Select MDB or DEX after checking interface hardware."));
  }
}

void printHelp() {
  Serial.println(F("Commands:"));
  Serial.println(F("  STATUS"));
  Serial.println(F("  MACHINE IDENTITY"));
  Serial.println(F("  CUP COUNTERS"));
  Serial.println(F("  SYNC CONFIG"));
  Serial.println(F("  UPLOAD NOW"));
  Serial.println(F("  HEARTBEAT NOW"));
  Serial.println(F("  LOCATION NOW"));
  Serial.println(F("  WIFI SET <ssid>|<password>"));
  Serial.println(F("  WIFI CLEAR"));
  Serial.println(F("  WIFI TEST"));
  Serial.println(F("  WIFI DB TEST     (Wi-Fi-only config read + ACK + commit heartbeat; no cellular fallback)"));
  Serial.println(F("  APN <name>        (blank value = automatic APN)"));
  Serial.println(F("  CELL TEST          (establish/test Air780EU manual PPP cellular IP)"));
  Serial.println(F("  CELL PPP STATUS"));
  Serial.println(F("  CELL PPP RESTART"));
  Serial.println(F("  CELL PPP ESCAPE     (guarded +++ then ATH command-mode recovery)"));
  Serial.println(F("  SIM DATA TEST     (safe cellular-only simulation and usage verification)"));
  Serial.println(F("  SIM DATA TEST RESET (allow the automatic test to run again after reboot)"));
  Serial.println(F("  DATA USAGE        (local per-transport application byte counters)"));
  Serial.println(F("  VODACOM BALANCE   (show Air780EU V1180 balance-query status)"));
  Serial.println(F("  CELL AT <command>"));
  Serial.println(F("  INTERFACE MDB|DEX|NORMALIZED_UART|DISABLED"));
  Serial.println(F("  DEX BAUD <baud>"));
  Serial.println(F("  DEX READ"));
  Serial.println(F("  MACHINE SERIAL <serial>"));
  Serial.println(F("  MACHINE SERIAL CLEAR"));
  Serial.println(F("  SUPABASE ANON KEY <JWT>  (stored in NVS; never echoed)"));
  Serial.println(F("  ENROLL TOKEN <one-time-token>  (optional emergency fallback)"));
  Serial.println(F("MDB is native/passive on ESP32-S3 RMT. GPIO4/GPIO5 remain input-only."));
}


void handleConsoleLine(String line) {
  line.trim();
  if (!line.length()) return;
  String upperLine = line;
  upperLine.toUpperCase();

  if (line.equalsIgnoreCase("STATUS")) { printStatus(); return; }
  if (line.equalsIgnoreCase("MACHINE IDENTITY")) { printMachineIdentity(); return; }
  if (line.equalsIgnoreCase("CUP COUNTERS")) { printCupCounters(); return; }
  if (line.equalsIgnoreCase("WIRING")) { printWiringMap(); return; }
  if (line.equalsIgnoreCase("HELP")) { printHelp(); return; }
  if (line.equalsIgnoreCase("SYNC CONFIG")) {
    lastConfigAttemptMs = 0;
    lastConfigSuccessMs = 0;
    syncRemotePolicy();
    return;
  }
  if (line.equalsIgnoreCase("UPLOAD NOW")) {
    counterUploadRequested = true;
    return;
  }
  if (line.equalsIgnoreCase("HEARTBEAT NOW")) {
    heartbeatUploadRequested = true;
    return;
  }
  if (line.equalsIgnoreCase("SIM DATA TEST RESET")) {
    saveAutomaticSimulationTestCompleted(false);
    lastSimulationUploadMs = 0;
    Serial.println(F("Automatic SIM data test flag cleared. Reboot, or type SIM DATA TEST now."));
    return;
  }
  if (line.equalsIgnoreCase("SIM DATA TEST")) {
    runVodacomSimDataTest();
    return;
  }
  if (line.equalsIgnoreCase("VODACOM BALANCE")) {
    queryVodacomPrepaidBalance();
    return;
  }
  if (line.equalsIgnoreCase("DATA USAGE")) {
    if (cellModemRegistered && !pppStarted) readCellModemDataUsage(false);
    char usageBuffer[24] = {0};
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationTxBytes));
    Serial.print(F("Cellular TX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularApplicationRxBytes));
    Serial.print(F("Cellular RX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(wifiApplicationTxBytes));
    Serial.print(F("Wi-Fi TX JSON bytes: ")); Serial.println(usageBuffer);
    snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(wifiApplicationRxBytes));
    Serial.print(F("Wi-Fi RX JSON bytes: ")); Serial.println(usageBuffer);
    if (cellularModemUsageAvailable) {
      snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularModemTxBytes));
      Serial.print(F("Air780E network TX bytes: ")); Serial.println(usageBuffer);
      snprintf(usageBuffer, sizeof(usageBuffer), "%llu", static_cast<unsigned long long>(cellularModemRxBytes));
      Serial.print(F("Air780E network RX bytes: ")); Serial.println(usageBuffer);
    } else {
      Serial.println(F("Air780E network byte counters unavailable."));
    }
    Serial.println(F("Vodacom billing may differ because carrier accounting is authoritative."));
    return;
  }
  if (line.equalsIgnoreCase("DEX READ")) {
    if (machineInterface != IFACE_DEX) {
      Serial.println(F("DEX is not selected. Use: INTERFACE DEX"));
    } else if (!dexRequestActive) {
      counterUploadRequested = true;
      requestDexAudit();
    } else {
      Serial.println(F("A DEX audit request is already active."));
    }
    return;
  }
  if (upperLine.startsWith("DEX BAUD ")) {
    uint32_t requestedBaud = static_cast<uint32_t>(line.substring(9).toInt());
    if (requestedBaud < 1200 || requestedBaud > 115200) {
      Serial.println(F("DEX baud must be between 1200 and 115200 (normally 9600)."));
      return;
    }
    dexBaud = requestedBaud;
    saveCoreSettings();
    if (machineInterface == IFACE_DEX || machineInterface == IFACE_NORMALIZED_UART) {
      restartMachineInterface();
    }
    Serial.print(F("DEX/normalized UART baud saved: "));
    Serial.println(dexBaud);
    return;
  }
  if (upperLine.startsWith("INTERFACE ") || upperLine.startsWith("MACHINE INTERFACE ")) {
    String requestedName = upperLine.startsWith("MACHINE INTERFACE ")
      ? line.substring(18) : line.substring(10);
    MachineInterface requested = parseInterface(requestedName);
    if (requested == IFACE_MDB_BRIDGE) {
      Serial.println(F("MDB_BRIDGE is obsolete in V6.8. Use: INTERFACE MDB"));
      requested = IFACE_MDB;
    }
    if (requested == IFACE_PULSE) {
      Serial.println(F("Pulse mode is not implemented in this hardware build."));
      return;
    }
    if (!selectableMachineInterface(requested)) {
      Serial.println(F("Use: INTERFACE MDB|DEX|NORMALIZED_UART|DISABLED"));
      return;
    }
    machineInterface = requested;
    saveCoreSettings();
    restartMachineInterface();
    heartbeatUploadRequested = true;
    Serial.print(F("Machine interface saved: "));
    Serial.println(interfaceName(machineInterface));
    if (machineInterface == IFACE_MDB) {
      Serial.println(F("Native MDB decoder selected. Both MDB GPIOs are passive RMT inputs."));
    }
    return;
  }
  if (line.equalsIgnoreCase("WIFI CLEAR")) {
    wifiSsid = "";
    wifiPassword = "";
    saveNetworkProvisioning();
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(true, false);
    wifiBeginIssued = false;
    wifiRadioDisabled = false;
    wifiConnectionStartedMs = 0;
    Serial.println(F("Stored Wi-Fi credentials cleared."));
    return;
  }
  if (line.startsWith("WIFI SET ")) {
    String value = line.substring(9);
    int separator = value.indexOf('|');
    if (separator <= 0) {
      Serial.println(F("Format: WIFI SET <ssid>|<password>"));
      return;
    }
    wifiSsid = value.substring(0, separator);
    wifiPassword = value.substring(separator + 1);
    wifiSsid.trim();
    if (!wifiSsid.length()) {
      Serial.println(F("SSID cannot be empty."));
      return;
    }
    saveNetworkProvisioning();
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(true, false);
    wifiBeginIssued = false;
    wifiRadioDisabled = false;
    wifiConnectionStartedMs = 0;
    Serial.println(F("Wi-Fi credentials stored in NVS. Password is not echoed."));
    return;
  }
  if (line.startsWith("ENROLL TOKEN ")) {
    if (deviceEnrolled()) {
      Serial.println(F("Device is already enrolled; token was not stored."));
      return;
    }
    enrollmentToken = line.substring(13);
    enrollmentToken.trim();
    if (enrollmentToken.length() < 16) {
      Serial.println(F("Enrollment token is too short / empty."));
      enrollmentToken = "";
      return;
    }
    saveEnrollmentToken();
    Serial.println(F("One-time enrollment token stored in NVS. It will be erased after successful enrollment."));
    lastEnrollmentAttemptMs = 0;
    return;
  }
  if (line.startsWith("SUPABASE ANON KEY ")) {
    supabaseAnonKey = line.substring(18);
    supabaseAnonKey.trim();
    if (supabaseAnonKey.length() < 80) {
      Serial.println(F("Supabase anon JWT is too short / empty."));
      supabaseAnonKey = "";
      return;
    }
    saveSupabaseAnonKey();
    Serial.println(F("Supabase anon JWT stored in NVS. The value is not echoed."));
    lastEnrollmentAttemptMs = 0;
    return;
  }

  if (line.equalsIgnoreCase("MACHINE SERIAL CLEAR")) {
    reportedMachineSerial = "";
    saveCoreSettings();
    heartbeatUploadRequested = true;
    Serial.println(F("Reported machine S/N cleared."));
    return;
  }
  if (upperLine.startsWith("MACHINE SERIAL ")) {
    reportedMachineSerial = line.substring(15);
    reportedMachineSerial.trim();
    saveCoreSettings();
    heartbeatUploadRequested = true;
    Serial.print(F("Reported machine S/N saved: "));
    Serial.println(reportedMachineSerial);
    return;
  }
  if (line.equalsIgnoreCase("LOCATION NOW")) {
    if (!policy.locationEnabled) Serial.println(F("Location reporting is disabled by remote policy."));
    else if (!gnssFix.valid && !fallbackLocationConfigured()) Serial.println(F("No valid GNSS fix and no manual fallback coordinates configured."));
    else uploadLocationUpdate();
    return;
  }

  if (line.equalsIgnoreCase("WIFI DB TEST")) {
    runWifiDatabaseTest();
    return;
  }
  if (line.equalsIgnoreCase("WIFI TEST")) {
    if (!wifiSsid.length()) {
      Serial.println(F("Wi-Fi is not provisioned. Use: WIFI SET <ssid>|<password>"));
    } else if (wifiReady()) {
      Serial.print(F("Wi-Fi connected. IP: "));
      Serial.println(WiFi.localIP());
      Serial.print(F("RSSI: "));
      Serial.println(WiFi.RSSI());
    } else if (!wifiBeginIssued) {
      if (!policy.wifiEnabled) {
        Serial.println(F("Wi-Fi is disabled by cached/remote policy; starting diagnostic Wi-Fi recovery without changing the saved DB policy."));
      }
      WiFi.mode(WIFI_STA);
      WiFi.setAutoReconnect(true);
      WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
      wifiBeginIssued = true;
      wifiRadioDisabled = false;
      lastWifiAttemptMs = millis();
      wifiConnectionStartedMs = lastWifiAttemptMs;
      Serial.println(F("Wi-Fi diagnostic connection started."));
    } else {
      Serial.print(F("Wi-Fi is already connecting / auto-reconnecting. status="));
      Serial.println(static_cast<int>(WiFi.status()));
      Serial.println(F("No second WiFi.begin() was issued."));
    }
    return;
  }
  if (line.startsWith("APN")) {
    apn = line.length() > 3 ? line.substring(3) : "";
    apn.trim();
    saveCoreSettings();
    if (pppStarted) stopCellularPpp(true);
    cellModemRegistered = false;
    cellReady = false;
    lastCellAttemptMs = 0;
    Serial.println(F("APN saved; PPP cellular will reconnect."));
    return;
  }
  if (line.equalsIgnoreCase("CELL TEST")) {
    bool ok = ensureCellularPpp();
    Serial.print(F("CELL TEST PPP="));
    Serial.print(ok ? "connected" : "failed");
    if (ok) {
      Serial.print(F(" IP="));
      Serial.print(airPppIpText());
    }
    Serial.println();
    return;
  }
  if (line.equalsIgnoreCase("CELL PPP STATUS")) {
    Serial.print(F("PPP started=")); Serial.print(pppStarted ? "yes" : "no");
    Serial.print(F(" online=")); Serial.print(pppOnline ? "yes" : "no");
    if (pppOnline) { Serial.print(F(" IP=")); Serial.print(airPppIpText()); }
    Serial.println();
    return;
  }
  if (line.equalsIgnoreCase("CELL PPP ESCAPE")) {
    if (pppStarted || airPppPcb != nullptr) {
      closeAirPppSession();
      restoreCellAtUart();
    }
    recoverAir780CommandMode(true);
    cellModemRegistered = false;
    lastCellAttemptMs = 0;
    return;
  }
  if (line.equalsIgnoreCase("CELL PPP RESTART")) {
    if (pppStarted) stopCellularPpp(true);
    else recoverAir780CommandMode(false);
    cellModemRegistered = false;
    lastCellAttemptMs = 0;
    Serial.println(F("PPP restart requested."));
    return;
  }
  if (line.startsWith("CELL AT ")) {
    if (pppStarted) {
      Serial.println(F("Stopping PPP temporarily for direct AT command."));
      stopCellularPpp(true);
      cellModemRegistered = false;
    }
    String cmd = line.substring(8);
    cellDrain();
    CellSerial.print(cmd); CellSerial.print("\r\n");
    Serial.println(cellReadUntil(5000, "OK", "ERROR", true));
    lastCellAttemptMs = millis();
    return;
  }
  if (line.startsWith("TEST FAULT ") || line.startsWith("TEST RECOVERY ")) {
    Serial.println(F("Synthetic fault injection is disabled in production firmware."));
    return;
  }

  Serial.println(F("Unknown command. Type HELP."));
}

void serviceConsole() {
  static String line;
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == '\r' || c == '\n') {
      if (line.length()) {
        handleConsoleLine(line);
        line = "";
      }
    } else if (line.length() < 512) {
      line += c;
    }
  }
}

void serviceSerialAlive() {
  uint32_t now = millis();
  if (lastSerialAliveMs != 0 && now - lastSerialAliveMs < SERIAL_ALIVE_INTERVAL_MS) return;
  lastSerialAliveMs = now;

  Serial.print(F("[ALIVE] firmware="));
  Serial.print(FIRMWARE_VERSION);
  Serial.print(F(" device="));
  Serial.print(deviceId.length() ? deviceId : "initialising");
  Serial.print(F(" cellular="));
  Serial.print(pppOnline ? "ppp" : (cellModemRegistered ? "registered" : "waiting"));
  Serial.print(F(" enrolled="));
  Serial.print(deviceEnrolled() ? "yes" : "no");
  Serial.print(F(" sim_test="));
  if (!DALLMAYR_SIM_DATA_TEST_ENABLED) Serial.print("disabled");
  else Serial.print(automaticSimulationTestCompleted ? "accepted" : "pending");
  Serial.print(F(" interface="));
  Serial.println(interfaceName(machineInterface));
}

// -----------------------------------------------------------------------------
// Arduino setup / loop
// -----------------------------------------------------------------------------

void setup() {
  // Required before raw lwIP PPP core-lock calls. In the isolated V6.8.31
  // diagnostic this was necessary because Network.begin() owns esp_netif init.
  Network.begin();
  Serial.begin(DEBUG_BAUD);
  // Give the ESP32-S3 native USB CDC port time to enumerate before the first
  // message. The repeating [ALIVE] line below also makes late monitor opens
  // visible instead of losing all evidence during boot.
  delay(2000);
  Serial.println();
  Serial.println(F("Dallmayr Telemetry V6.8.44 - PASSIVE MDB + DEX + AUTO-PROFILE EVIDENCE + CUP COUNTERS + WIFI/MANUAL PPPOS"));
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  Serial.println(F("Console transport: ESP32-S3 USB CDC (correct for the native USB connector)."));
#else
  Serial.println(F("Console transport: UART0. If using the ESP32-S3 native USB connector, enable Tools > USB CDC On Boot."));
#endif
  Serial.println(F("Power-on flow: DB transport policy -> Wi-Fi when primary -> Air780EU manual PPP recovery/primary -> ESP32 TLS -> Supabase."));

  initializeDeviceIdentity();
  makeRandomId(bootId, sizeof(bootId));
  loadCoreSettings();
  loadCachedPolicy();
  loadCounters();
  memset(faults, 0, sizeof(faults));

  WiFi.persistent(false);
  CellSerial.begin(CELL_BAUD, SERIAL_8N1, CELL_RX_PIN, CELL_TX_PIN);

  const bool cellularBootstrap =
    policy.cellularEnabled && strcmp(policy.transportPreference, "cellular") == 0;

  if (cellularBootstrap) {
    // Reproduce the successful V6.8.31 diagnostic environment during the first
    // PPP handshake: no Wi-Fi station, no MDB capture task, no GNSS/background
    // machine services. Establish PPP first, then start the rest of the device.
    WiFi.setAutoReconnect(false);
    WiFi.mode(WIFI_OFF);
    wifiRadioDisabled = true;

    Serial.println(F("Cellular-preferred isolated bootstrap: Wi-Fi and machine I/O held off until first PPP attempt completes."));
    bool bootstrapRegistered = initializeCellular();
    bool bootstrapPpp = bootstrapRegistered && startCellularPpp();
    Serial.print(F("Cellular bootstrap result: "));
    if (bootstrapPpp) {
      Serial.print(F("PPP RUNNING IP="));
      Serial.println(airPppIpText());
    } else {
      Serial.println(F("PPP not established; normal maintenance retries will continue after application startup."));
    }
    lastCellAttemptMs = millis();
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    wifiRadioDisabled = false;
    lastCellAttemptMs = millis() - CELL_RETRY_MS;
  }

  // Start machine services only after the isolated cellular bootstrap window.
  if (!DALLMAYR_MACHINE_IO_ENABLED) {
    machineInterface = IFACE_DISABLED;
    Serial.println(F("Machine I/O support is not compiled in."));
  } else {
    restartMachineInterface();
    if (machineInterface == IFACE_DISABLED) {
      Serial.println(F("Machine interface is disabled. Use INTERFACE MDB or INTERFACE DEX after hardware checks."));
    }
  }
  startGnss();

  // Always publish a genuine device heartbeat after the first available transport comes up.
  heartbeatUploadRequested = true;
  lastWifiAttemptMs = millis();
  lastCounterSaveMs = millis();
  counterScheduleStartMs = millis();
  lastDataUsageSaveMs = millis();
  printStatus();
  printHelp();
}

void loop() {
  serviceConsole();
  serviceSerialAlive();
  if (DALLMAYR_MACHINE_IO_ENABLED) serviceMachineInterface();
  serviceGnss();
  maintainCounterStorage();
  maintainDataUsageStorage();
  maintainWiFi();
  maintainCellular();
  maintainEnrollment();
  servicePrepaidBalance();
  serviceAutomaticSimDataTest();
  maintainRemotePolicy();
  serviceConfigAck();
  serviceTransportTransitionCommit();
  serviceLocation();
  serviceHeartbeatSchedule();
  serviceCounterSchedule();
  serviceUploads();
  serviceRemoteDebug();
  delay(2);
}
