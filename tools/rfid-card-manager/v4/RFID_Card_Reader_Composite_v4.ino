/*
  Dallmayr RFID Card Reader - Composite USB v4.0
  Arduino UNO R4 WiFi + MFRC522 + common-cathode RGB LED

  USB ARCHITECTURE
  ----------------
  The UNO R4 exposes both interfaces over the same USB-C cable:
    1) USB CDC serial  -> structured scan data + localhost companion control
    2) USB HID keyboard -> optional keyboard-wedge output

  DEFAULT BEHAVIOUR
  -----------------
  - Localhost/CDC mode is primary.
  - HID keyboard-wedge output is OFF by default to prevent accidental typing.
  - Windows RFID Manager opens http://localhost:8765 as soon as it detects the reader.
  - The web UI can enable/disable HID keyboard output and optional Enter-after-scan.
  - Reverse DEC is always exactly 10 digits, padded with zeros on the left.

  FIRST USE
  ---------
  1. Reader sends HELLO over USB CDC.
  2. RFID Manager replies HOST|RFID_MANAGER|4|OK.
  3. If no companion is found within SETUP_CHECK_MS, the reader uses its HID
     interface only to open the first-time setup page. It does NOT run an installer.
  4. User approves the Windows companion installation once.
  5. Future plug-ins open the localhost scanner automatically via the companion.

  UPGRADE COMPATIBILITY
  ---------------------
  v4 firmware also accepts the v3 host handshake so firmware and Windows software
  can be upgraded in either order.

  RC522 -> UNO R4 WIFI
  -------------------
  SDA / SS -> D10
  SCK      -> D13
  MOSI     -> D11
  MISO     -> D12
  IRQ      -> not connected
  GND      -> GND
  RST      -> D9
  3.3V     -> 3.3V

  RGB LED - COMMON CATHODE
  -----------------------
  Common cathode -> GND
  Red   -> 220-330 ohm -> D3
  Green -> 220-330 ohm -> D5
  Blue  -> 220-330 ohm -> D6

  LED STATUS
  ----------
  Yellow = checking for Windows companion
  Blue   = companion connected / ready
  Green  = scan accepted
  Red    = RFID hardware error
  Purple = setup page opened because companion was not detected

  REQUIRED LIBRARIES
  ------------------
  SPI.h
  MFRC522.h
  Keyboard.h (UNO R4 core)
*/

#include <SPI.h>
#include <MFRC522.h>
#include <Keyboard.h>

#define RFID_SS_PIN   10
#define RFID_RST_PIN   9
#define LED_RED_PIN    3
#define LED_GREEN_PIN  5
#define LED_BLUE_PIN   6

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

const char *FIRMWARE_VERSION = "4.0";
const char *SETUP_URL =
  "https://github.com/matthiathan/DallmayrERP/blob/main/tools/rfid-card-manager/v4/Install_RFID_Manager_v4.cmd";

const unsigned long SETUP_CHECK_MS = 12000;
const unsigned long HELLO_INTERVAL_MS = 900;
const unsigned long HEARTBEAT_INTERVAL_MS = 5000;
const unsigned long HOST_TIMEOUT_MS = 15000;
const unsigned long SAME_CARD_DELAY_MS = 1200;

bool hostReady = false;
bool hostWasEverReady = false;
bool setupOpened = false;
bool hidWedgeEnabled = false;
bool hidAppendEnter = true;

unsigned long bootMs = 0;
unsigned long lastHelloMs = 0;
unsigned long lastHeartbeatMs = 0;
unsigned long lastHostSeenMs = 0;
String serialLine = "";

String previousScannedUID = "";
unsigned long lastScanTime = 0;

void setLED(bool red, bool green, bool blue) {
  digitalWrite(LED_RED_PIN, red ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, green ? HIGH : LOW);
  digitalWrite(LED_BLUE_PIN, blue ? HIGH : LOW);
}

void showCheckingLED() { setLED(true, true, false); }
void showReadyLED()    { setLED(false, false, true); }
void showSetupLED()    { setLED(true, false, true); }
void showErrorLED()    { setLED(true, false, false); }

void flashSuccess() {
  setLED(false, true, false);
  delay(160);
  if (hostReady) showReadyLED();
  else if (setupOpened) showSetupLED();
  else showCheckingLED();
}

String getRawUIDHex() {
  String s;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) s += "0";
    s += String(rfid.uid.uidByte[i], HEX);
    if (i + 1 < rfid.uid.size) s += " ";
  }
  s.toUpperCase();
  return s;
}

uint32_t getIDDec() {
  uint32_t result = 0;
  uint32_t factor = 1;
  for (byte i = 0; i < rfid.uid.size; i++) {
    result += (uint32_t)rfid.uid.uidByte[i] * factor;
    factor *= 256UL;
  }
  return result;
}

uint32_t getIDReverseDec() {
  uint32_t result = 0;
  for (byte i = 0; i < rfid.uid.size; i++) {
    result = (result << 8) | rfid.uid.uidByte[i];
  }
  return result;
}

void uint32ToPadded10Text(uint32_t value, char *buffer, size_t bufferSize) {
  snprintf(buffer, bufferSize, "%010lu", (unsigned long)value);
}

String sanitizeField(String value) {
  value.replace("|", "/");
  value.replace("\r", " ");
  value.replace("\n", " ");
  return value;
}

void emitDeviceStatus() {
  Serial.print("DEVICE|STATUS|HID=");
  Serial.print(hidWedgeEnabled ? "1" : "0");
  Serial.print("|ENTER=");
  Serial.println(hidAppendEnter ? "1" : "0");
}

void emitHello() {
  Serial.print("HELLO|RFID_READER|");
  Serial.print(FIRMWARE_VERSION);
  Serial.println("|UNO_R4|CDC_HID");
  lastHelloMs = millis();
}

void markHostReady() {
  const bool firstConnection = !hostReady;
  hostReady = true;
  hostWasEverReady = true;
  lastHostSeenMs = millis();
  if (firstConnection) {
    showReadyLED();
    Serial.println("STATUS|HOST_CONNECTED|USB=CDC_HID");
    emitDeviceStatus();
  }
}

void processHostCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  // v4 plus v3 compatibility during upgrade.
  if (line.startsWith("HOST|RFID_MANAGER|4|OK") ||
      line.startsWith("HOST|RFID_MANAGER|3|OK") ||
      line == "PONG|RFID_MANAGER|4" ||
      line == "PONG|RFID_MANAGER|3") {
    markHostReady();
    return;
  }

  if (line == "PING|RFID_MANAGER|4" || line == "PING|RFID_MANAGER|3") {
    Serial.println("PONG|RFID_READER|4");
    markHostReady();
    return;
  }

  if (line == "MODE|HID|ON") {
    hidWedgeEnabled = true;
    Serial.println("ACK|MODE|HID|ON");
    emitDeviceStatus();
    return;
  }

  if (line == "MODE|HID|OFF") {
    hidWedgeEnabled = false;
    Keyboard.releaseAll();
    Serial.println("ACK|MODE|HID|OFF");
    emitDeviceStatus();
    return;
  }

  if (line == "MODE|ENTER|ON") {
    hidAppendEnter = true;
    Serial.println("ACK|MODE|ENTER|ON");
    emitDeviceStatus();
    return;
  }

  if (line == "MODE|ENTER|OFF") {
    hidAppendEnter = false;
    Serial.println("ACK|MODE|ENTER|OFF");
    emitDeviceStatus();
    return;
  }

  if (line == "GET|STATUS") {
    emitDeviceStatus();
    return;
  }
}

void pollSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      processHostCommand(serialLine);
      serialLine = "";
    } else if (serialLine.length() < 180) {
      serialLine += c;
    } else {
      serialLine = "";
    }
  }
}

void openSetupPage() {
  if (setupOpened) return;
  setupOpened = true;

  Serial.println("STATUS|HOST_NOT_FOUND|OPENING_SETUP");
  showSetupLED();

  // First-use assistance only. HID opens a browser URL; it does not execute
  // PowerShell, cmd, or an installer. Windows/user still authorizes install.
  Keyboard.releaseAll();
  Keyboard.press(KEY_LEFT_GUI);
  Keyboard.press('r');
  delay(100);
  Keyboard.releaseAll();
  delay(250);
  Keyboard.print(SETUP_URL);
  delay(100);
  Keyboard.write(KEY_RETURN);
  delay(250);
  Keyboard.releaseAll();
}

void maintainHostHandshake() {
  const unsigned long now = millis();

  pollSerialCommands();

  if (!hostReady) {
    if (now - lastHelloMs >= HELLO_INTERVAL_MS) {
      emitHello();
    }

    if (!hostWasEverReady && !setupOpened && now - bootMs >= SETUP_CHECK_MS) {
      openSetupPage();
    }
    return;
  }

  if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    Serial.println("PING|RFID_READER|4");
    lastHeartbeatMs = now;
  }

  if (now - lastHostSeenMs >= HOST_TIMEOUT_MS) {
    hostReady = false;
    showCheckingLED();
    Serial.println("STATUS|HOST_TIMEOUT");
  }
}

void typeReverseDecAsKeyboard(const char *reverseDec) {
  if (!hidWedgeEnabled) return;

  Keyboard.releaseAll();
  Keyboard.print(reverseDec);
  if (hidAppendEnter) {
    Keyboard.write(KEY_RETURN);
  }
  Keyboard.releaseAll();
}

void emitScanRecord(MFRC522::PICC_Type type) {
  if (rfid.uid.size != 4) {
    Serial.print("INFO|Unsupported UID length: ");
    Serial.println(rfid.uid.size);
    return;
  }

  const String uid = getRawUIDHex();
  const uint32_t idDec = getIDDec();
  const uint32_t idReverseDec = getIDReverseDec();

  char reverseBuffer[11];
  uint32ToPadded10Text(idReverseDec, reverseBuffer, sizeof(reverseBuffer));

  String cardType = sanitizeField(String(rfid.PICC_GetTypeName(type)));

  // CDC record: RFID|UID HEX|ID DEC|REVERSE DEC 10 DIGITS|CARD TYPE
  Serial.print("RFID|");
  Serial.print(uid);
  Serial.print("|");
  Serial.print((unsigned long)idDec);
  Serial.print("|");
  Serial.print(reverseBuffer);
  Serial.print("|");
  Serial.println(cardType);

  // Optional HID keyboard-wedge output.
  typeReverseDecAsKeyboard(reverseBuffer);
}

void setup() {
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_BLUE_PIN, OUTPUT);
  showCheckingLED();

  // Starting Keyboard and Serial together gives the intended composite USB
  // behaviour on the UNO R4 core: HID keyboard + CDC serial over one cable.
  Keyboard.begin();
  Serial.begin(115200);
  delay(800);
  bootMs = millis();

  SPI.begin();
  rfid.PCD_Init();
  delay(100);

  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.println();
  Serial.println("Dallmayr RFID Composite Reader v4.0");
  Serial.println("USB interfaces: CDC serial + HID keyboard");
  Serial.print("MFRC522 Version: 0x");
  if (version < 0x10) Serial.print("0");
  Serial.println(version, HEX);

  if (version == 0x00 || version == 0xFF) {
    Serial.println("ERROR|MFRC522 not detected");
    showErrorLED();
    while (true) delay(1000);
  }

  rfid.PCD_SetAntennaGain(rfid.RxGain_max);
  emitHello();
}

void loop() {
  maintainHostHandshake();

  if (!rfid.PICC_IsNewCardPresent()) {
    delay(2);
    return;
  }
  if (!rfid.PICC_ReadCardSerial()) return;

  const MFRC522::PICC_Type type = rfid.PICC_GetType(rfid.uid.sak);
  const String currentUID = getRawUIDHex();
  const unsigned long now = millis();

  if (currentUID == previousScannedUID && (now - lastScanTime) < SAME_CARD_DELAY_MS) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  previousScannedUID = currentUID;
  lastScanTime = now;

  emitScanRecord(type);
  flashSuccess();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
