/*
  RFID Card Reader - Auto Setup / Localhost v3.0
  Arduino UNO R4 WiFi + MFRC522 + common-cathode RGB LED

  BEHAVIOUR
  ---------
  1. Reader starts over USB and sends a HELLO handshake.
  2. Installed Windows RFID Manager replies HOST|RFID_MANAGER|3|OK.
  3. If no reply is received within SETUP_CHECK_MS, the reader opens the
     first-time setup page in the default Windows browser once per power-up.
  4. After the companion is installed/running, future plug-ins are automatic.
  5. First scanned card opens localhost. Further cards append to the table.
  6. Reverse DEC is always exactly 10 digits with left-side zero padding.

  IMPORTANT
  ---------
  Windows intentionally requires the user to approve the first software
  installation. This firmware opens the setup page; it does not silently type
  or execute PowerShell/installer commands.

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
  Blue   = companion connected / ready to scan
  Green  = scan accepted
  Red    = RFID hardware error
  Purple = setup page opened because companion was not detected

  REQUIRED LIBRARIES
  ------------------
  SPI.h
  MFRC522.h
  Keyboard.h (included with UNO R4 core)
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

const char *FIRMWARE_VERSION = "3.0";
const char *SETUP_URL =
  "https://github.com/matthiathan/DallmayrERP/blob/main/tools/rfid-card-manager/v3/Install_RFID_Manager.cmd";

const unsigned long SETUP_CHECK_MS = 12000;
const unsigned long HELLO_INTERVAL_MS = 900;
const unsigned long HEARTBEAT_INTERVAL_MS = 5000;
const unsigned long HOST_TIMEOUT_MS = 15000;
const unsigned long SAME_CARD_DELAY_MS = 1200;

bool hostReady = false;
bool hostWasEverReady = false;
bool setupOpened = false;
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
  delay(180);
  if (hostReady) showReadyLED();
  else showSetupLED();
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

void emitHello() {
  Serial.print("HELLO|RFID_READER|");
  Serial.print(FIRMWARE_VERSION);
  Serial.println("|UNO_R4");
  lastHelloMs = millis();
}

void processHostCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  if (line.startsWith("HOST|RFID_MANAGER|3|OK") || line == "PONG|RFID_MANAGER|3") {
    const bool firstConnection = !hostReady;
    hostReady = true;
    hostWasEverReady = true;
    lastHostSeenMs = millis();
    if (firstConnection) {
      showReadyLED();
      Serial.println("STATUS|HOST_CONNECTED");
    }
    return;
  }

  if (line == "PING|RFID_MANAGER|3") {
    Serial.println("PONG|RFID_READER|3");
    lastHostSeenMs = millis();
    hostReady = true;
    hostWasEverReady = true;
    showReadyLED();
  }
}

void pollSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      processHostCommand(serialLine);
      serialLine = "";
    } else if (serialLine.length() < 160) {
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

  // User-authorized first-use assistance only: open a browser page.
  // No installer or shell command is executed by the keyboard emulation.
  Keyboard.begin();
  delay(250);
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
  Keyboard.end();
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
    Serial.println("PING|RFID_READER|3");
    lastHeartbeatMs = now;
  }

  if (now - lastHostSeenMs >= HOST_TIMEOUT_MS) {
    hostReady = false;
    showCheckingLED();
    Serial.println("STATUS|HOST_TIMEOUT");
  }
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

  // RFID|UID HEX|ID DEC|REVERSE DEC 10 DIGITS|CARD TYPE
  Serial.print("RFID|");
  Serial.print(uid);
  Serial.print("|");
  Serial.print((unsigned long)idDec);
  Serial.print("|");
  Serial.print(reverseBuffer);
  Serial.print("|");
  Serial.println(cardType);
}

void setup() {
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_BLUE_PIN, OUTPUT);
  showCheckingLED();

  Serial.begin(115200);
  delay(800);
  bootMs = millis();

  SPI.begin();
  rfid.PCD_Init();
  delay(100);

  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.println();
  Serial.println("RFID Localhost Reader v3.0");
  Serial.println("USB handshake + first-use setup detection");
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
