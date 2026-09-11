/*
  Dallmayr RFID Card Reader - No Install v5.0
  Arduino UNO R4 WiFi + MFRC522

  No localhost service, no Windows installer, no Arduino hotspot.

  On USB power-up the reader uses standard USB HID keyboard support to open:
    https://dallmayrerp.onrender.com/rfid-scanner

  Each 4-byte card scan types one structured line into the page:
    RFID|UID HEX|ID DEC|REVERSE DEC 10 DIGITS|CARD TYPE

  The web page captures the line globally and stores the card in its table.

  RC522 -> UNO R4 WiFi
    SDA / SS -> D10
    SCK      -> D13
    MOSI     -> D11
    MISO     -> D12
    RST      -> D9
    3.3V     -> 3.3V
    GND      -> GND

  RGB LED (common cathode, optional)
    Red   -> 220-330 ohm -> D3
    Green -> 220-330 ohm -> D5
    Blue  -> 220-330 ohm -> D6
    Common cathode -> GND
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

const char *FIRMWARE_VERSION = "5.0";
const char *SCANNER_URL = "https://dallmayrerp.onrender.com/rfid-scanner";

const unsigned long OPEN_PAGE_DELAY_MS = 1800;
const unsigned long SAME_CARD_DELAY_MS = 1200;

String previousScannedUID = "";
unsigned long lastScanTime = 0;

void setLED(bool red, bool green, bool blue) {
  digitalWrite(LED_RED_PIN, red ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, green ? HIGH : LOW);
  digitalWrite(LED_BLUE_PIN, blue ? HIGH : LOW);
}

void showStartingLED() { setLED(true, true, false); }
void showReadyLED()    { setLED(false, false, true); }
void showErrorLED()    { setLED(true, false, false); }

void flashSuccess() {
  setLED(false, true, false);
  delay(160);
  showReadyLED();
}

String getRawUIDHex() {
  String value;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) value += "0";
    value += String(rfid.uid.uidByte[i], HEX);
    if (i + 1 < rfid.uid.size) value += " ";
  }
  value.toUpperCase();
  return value;
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

void openScannerPage() {
  showStartingLED();
  Keyboard.begin();
  delay(250);
  Keyboard.releaseAll();

  // Windows + R opens the Run dialog. Typing an HTTPS URL opens it in the
  // user's default browser. No software is installed or executed.
  Keyboard.press(KEY_LEFT_GUI);
  Keyboard.press('r');
  delay(120);
  Keyboard.releaseAll();
  delay(220);
  Keyboard.print(SCANNER_URL);
  delay(120);
  Keyboard.write(KEY_RETURN);
  delay(300);
  Keyboard.releaseAll();

  showReadyLED();
}

void typeScanRecord(MFRC522::PICC_Type type) {
  if (rfid.uid.size != 4) {
    Serial.print("Unsupported UID length: ");
    Serial.println(rfid.uid.size);
    return;
  }

  const String uid = getRawUIDHex();
  const uint32_t idDec = getIDDec();
  const uint32_t reverseDec = getIDReverseDec();
  char reverseBuffer[11];
  uint32ToPadded10Text(reverseDec, reverseBuffer, sizeof(reverseBuffer));
  const String cardType = sanitizeField(String(rfid.PICC_GetTypeName(type)));

  String line = "RFID|";
  line += uid;
  line += "|";
  line += String((unsigned long)idDec);
  line += "|";
  line += reverseBuffer;
  line += "|";
  line += cardType;

  Keyboard.print(line);
  Keyboard.write(KEY_RETURN);

  Serial.print("Scanned: ");
  Serial.println(line);
}

void setup() {
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_BLUE_PIN, OUTPUT);
  showStartingLED();

  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();
  delay(100);

  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0x00 || version == 0xFF) {
    showErrorLED();
    while (true) delay(1000);
  }

  rfid.PCD_SetAntennaGain(rfid.RxGain_max);

  delay(OPEN_PAGE_DELAY_MS);
  openScannerPage();

  Serial.print("Dallmayr RFID Reader v");
  Serial.println(FIRMWARE_VERSION);
  Serial.println("No-install HID mode ready.");
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent()) {
    delay(2);
    return;
  }
  if (!rfid.PICC_ReadCardSerial()) return;

  const String currentUID = getRawUIDHex();
  const unsigned long now = millis();

  if (currentUID == previousScannedUID && (now - lastScanTime) < SAME_CARD_DELAY_MS) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  previousScannedUID = currentUID;
  lastScanTime = now;

  const MFRC522::PICC_Type type = rfid.PICC_GetType(rfid.uid.sak);
  typeScanRecord(type);
  flashSuccess();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
