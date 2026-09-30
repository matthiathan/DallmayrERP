/*
  Dallmayr RFID Reader - ESP32 DevKit USB Serial Edition
  ======================================================

  Target:
    Classic ESP32 DevKit / ESP32-WROOM-32 with CP2102 USB-to-UART.

  MFRC522 wiring:
    SDA / SS -> GPIO 5
    SCK      -> GPIO 18
    MOSI     -> GPIO 23
    MISO     -> GPIO 19
    RST      -> GPIO 22
    3.3V     -> 3V3
    GND      -> GND
    IRQ      -> not connected

  Browser:
    https://dallmayrerp.onrender.com/rfid-scanner

  Serial protocol:
    Baud: 115200
    ESP32 -> browser: one JSON object per line
    Browser -> ESP32 commands:
      PING
      READ
      WRITE|up to 16 printable ASCII characters
      CANCEL

  Notes:
    - No Wi-Fi, access point, captive portal or web server is used.
    - ID values are emitted as JSON strings so leading zeroes are preserved.
    - ID(reverse dec) is padded to exactly 10 digits.
    - MIFARE Classic block 4 uses factory/default Key A FF FF FF FF FF FF.
*/

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>

// ---------------- Pin mapping ----------------
static const uint8_t RFID_SS_PIN   = 5;
static const uint8_t RFID_RST_PIN  = 22;
static const uint8_t SPI_SCK_PIN   = 18;
static const uint8_t SPI_MISO_PIN  = 19;
static const uint8_t SPI_MOSI_PIN  = 23;

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

// ---------------- MIFARE Classic ----------------
const byte DATA_BLOCK = 4;
const byte SECTOR_1_TRAILER_BLOCK = 7;
MFRC522::MIFARE_Key mifareKey;

enum PendingAction {
  ACTION_NONE,
  ACTION_READ,
  ACTION_WRITE
};

PendingAction pendingAction = ACTION_NONE;
String pendingWriteText;

// ---------------- Scan debounce ----------------
String previousUID;
unsigned long lastScanTime = 0;
const unsigned long SAME_CARD_DELAY_MS = 1200;

// ---------------- USB serial command buffer ----------------
String commandBuffer;

// ============================================================
// Helpers
// ============================================================

String jsonEscape(const String &input) {
  String out;
  out.reserve(input.length() + 8);

  for (unsigned int i = 0; i < input.length(); i++) {
    const char c = input[i];
    switch (c) {
      case '\\': out += "\\\\"; break;
      case '"':  out += "\\\""; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if ((uint8_t)c >= 32) out += c;
        break;
    }
  }
  return out;
}

void sendStatus(const String &message) {
  Serial.print("{\"type\":\"status\",\"message\":\"");
  Serial.print(jsonEscape(message));
  Serial.println("\"}");
}

void sendError(const String &message) {
  Serial.print("{\"type\":\"error\",\"message\":\"");
  Serial.print(jsonEscape(message));
  Serial.println("\"}");
}

void sendReady() {
  Serial.println("{\"type\":\"ready\",\"device\":\"Dallmayr RFID Reader\",\"version\":\"1.0.0\"}");
}

String bytesToDecimal(const byte *data, byte length, bool littleEndian) {
  const int MAX_DIGITS = 32;
  byte digits[MAX_DIGITS];
  memset(digits, 0, sizeof(digits));
  int digitCount = 1;

  for (int step = 0; step < length; step++) {
    const int index = littleEndian ? (length - 1 - step) : step;
    int carry = data[index];

    for (int d = 0; d < digitCount; d++) {
      const int value = digits[d] * 256 + carry;
      digits[d] = value % 10;
      carry = value / 10;
    }

    while (carry > 0 && digitCount < MAX_DIGITS) {
      digits[digitCount++] = carry % 10;
      carry /= 10;
    }
  }

  String result;
  result.reserve(digitCount);
  for (int d = digitCount - 1; d >= 0; d--) {
    result += char('0' + digits[d]);
  }
  return result;
}

String padLeft10(const String &value) {
  if (value.length() >= 10) return value;
  String result;
  result.reserve(10);
  for (unsigned int i = value.length(); i < 10; i++) result += '0';
  result += value;
  return result;
}

String getRawUIDHex() {
  String out;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) out += '0';
    out += String(rfid.uid.uidByte[i], HEX);
    if (i + 1 < rfid.uid.size) out += ' ';
  }
  out.toUpperCase();
  return out;
}

// Matches the byte-order convention used by the existing Dallmayr RFID project.
String getIDDec() {
  return bytesToDecimal(rfid.uid.uidByte, rfid.uid.size, true);
}

String getIDReverseDec() {
  return padLeft10(bytesToDecimal(rfid.uid.uidByte, rfid.uid.size, false));
}

bool isMifareClassic(MFRC522::PICC_Type type) {
  return type == MFRC522::PICC_TYPE_MIFARE_MINI ||
         type == MFRC522::PICC_TYPE_MIFARE_1K ||
         type == MFRC522::PICC_TYPE_MIFARE_4K;
}

String blockToText(const byte *data) {
  String out;
  for (byte i = 0; i < 16; i++) {
    if (data[i] == 0x00) break;
    out += (data[i] >= 32 && data[i] <= 126) ? (char)data[i] : '.';
  }
  return out;
}

String blockToHex(const byte *data) {
  String out;
  for (byte i = 0; i < 16; i++) {
    if (data[i] < 0x10) out += '0';
    out += String(data[i], HEX);
    if (i < 15) out += ' ';
  }
  out.toUpperCase();
  return out;
}

bool authenticateSector1(String &errorMessage) {
  const MFRC522::StatusCode status = (MFRC522::StatusCode)rfid.PCD_Authenticate(
    MFRC522::PICC_CMD_MF_AUTH_KEY_A,
    SECTOR_1_TRAILER_BLOCK,
    &mifareKey,
    &(rfid.uid)
  );

  if (status != MFRC522::STATUS_OK) {
    errorMessage = "Authentication failed: ";
    errorMessage += rfid.GetStatusCodeName(status);
    return false;
  }
  return true;
}

bool readDataBlock(byte out16[16], String &errorMessage) {
  if (!authenticateSector1(errorMessage)) return false;

  byte buffer[18];
  byte size = sizeof(buffer);
  const MFRC522::StatusCode status = (MFRC522::StatusCode)rfid.MIFARE_Read(DATA_BLOCK, buffer, &size);

  if (status != MFRC522::STATUS_OK) {
    errorMessage = "Block 4 read failed: ";
    errorMessage += rfid.GetStatusCodeName(status);
    return false;
  }

  memcpy(out16, buffer, 16);
  return true;
}

bool writeDataBlock(const String &text, byte verifyOut[16], String &errorMessage) {
  byte writeBuffer[16];
  memset(writeBuffer, 0, sizeof(writeBuffer));

  const byte count = min((int)text.length(), 16);
  for (byte i = 0; i < count; i++) writeBuffer[i] = (byte)text[i];

  if (!authenticateSector1(errorMessage)) return false;

  MFRC522::StatusCode status = (MFRC522::StatusCode)rfid.MIFARE_Write(DATA_BLOCK, writeBuffer, 16);
  if (status != MFRC522::STATUS_OK) {
    errorMessage = "Block 4 write failed: ";
    errorMessage += rfid.GetStatusCodeName(status);
    return false;
  }

  byte verifyBuffer[18];
  byte verifySize = sizeof(verifyBuffer);
  status = (MFRC522::StatusCode)rfid.MIFARE_Read(DATA_BLOCK, verifyBuffer, &verifySize);
  if (status != MFRC522::STATUS_OK) {
    errorMessage = "Write completed, but verification read failed: ";
    errorMessage += rfid.GetStatusCodeName(status);
    return false;
  }

  if (memcmp(writeBuffer, verifyBuffer, 16) != 0) {
    errorMessage = "Write verification failed: returned data did not match.";
    return false;
  }

  memcpy(verifyOut, verifyBuffer, 16);
  return true;
}

void finishCardTransaction() {
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

void sendScanEvent(MFRC522::PICC_Type type) {
  const String uid = getRawUIDHex();
  const String idDec = getIDDec();
  const String reverseDec = getIDReverseDec();
  const String cardType = String(rfid.PICC_GetTypeName(type));

  Serial.print("{\"type\":\"scan\",\"uid\":\"");
  Serial.print(jsonEscape(uid));
  Serial.print("\",\"idDec\":\"");
  Serial.print(jsonEscape(idDec));
  Serial.print("\",\"idReverseDec\":\"");
  Serial.print(jsonEscape(reverseDec));
  Serial.print("\",\"cardType\":\"");
  Serial.print(jsonEscape(cardType));
  Serial.println("\"}");
}

void sendReadResult(bool success, const String &message, const byte *data = nullptr) {
  Serial.print("{\"type\":\"read_result\",\"success\":");
  Serial.print(success ? "true" : "false");
  Serial.print(",\"message\":\"");
  Serial.print(jsonEscape(message));
  Serial.print("\"");

  if (success && data != nullptr) {
    Serial.print(",\"data\":\"");
    Serial.print(jsonEscape(blockToText(data)));
    Serial.print("\",\"blockHex\":\"");
    Serial.print(jsonEscape(blockToHex(data)));
    Serial.print("\"");
  }
  Serial.println("}");
}

void sendWriteResult(bool success, const String &message, const byte *data = nullptr) {
  Serial.print("{\"type\":\"write_result\",\"success\":");
  Serial.print(success ? "true" : "false");
  Serial.print(",\"message\":\"");
  Serial.print(jsonEscape(message));
  Serial.print("\"");

  if (success && data != nullptr) {
    Serial.print(",\"data\":\"");
    Serial.print(jsonEscape(blockToText(data)));
    Serial.print("\",\"blockHex\":\"");
    Serial.print(jsonEscape(blockToHex(data)));
    Serial.print("\"");
  }
  Serial.println("}");
}

// ============================================================
// Browser -> ESP32 commands
// ============================================================

bool validWriteText(const String &text) {
  if (text.length() == 0 || text.length() > 16) return false;
  for (unsigned int i = 0; i < text.length(); i++) {
    const char c = text[i];
    if (c < 32 || c > 126 || c == '|') return false;
  }
  return true;
}

void handleCommand(String command) {
  command.trim();
  if (!command.length()) return;

  if (command == "PING") {
    sendReady();
    return;
  }

  if (command == "READ") {
    pendingAction = ACTION_READ;
    pendingWriteText = "";
    sendStatus("Read requested. Present the MIFARE Classic card.");
    return;
  }

  if (command == "CANCEL") {
    pendingAction = ACTION_NONE;
    pendingWriteText = "";
    sendStatus("Pending card operation cancelled.");
    return;
  }

  if (command.startsWith("WRITE|")) {
    const String text = command.substring(6);
    if (!validWriteText(text)) {
      sendError("Write data must contain 1 to 16 printable characters and cannot contain |.");
      return;
    }

    pendingWriteText = text;
    pendingAction = ACTION_WRITE;
    sendStatus("Write requested. Present the MIFARE Classic card.");
    return;
  }

  sendError("Unknown command.");
}

void processSerialCommands() {
  while (Serial.available()) {
    const char c = (char)Serial.read();

    if (c == '\n') {
      handleCommand(commandBuffer);
      commandBuffer = "";
    } else if (c != '\r') {
      if (commandBuffer.length() < 96) {
        commandBuffer += c;
      } else {
        commandBuffer = "";
        sendError("Serial command was too long.");
      }
    }
  }
}

// ============================================================
// RFID processing
// ============================================================

void handleRFID() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  const String currentUID = getRawUIDHex();
  const unsigned long now = millis();

  if (currentUID == previousUID && now - lastScanTime < SAME_CARD_DELAY_MS) {
    finishCardTransaction();
    return;
  }

  previousUID = currentUID;
  lastScanTime = now;

  const MFRC522::PICC_Type type = rfid.PICC_GetType(rfid.uid.sak);
  sendScanEvent(type);

  if (pendingAction == ACTION_READ) {
    if (!isMifareClassic(type)) {
      sendReadResult(false, "Card detected, but memory read/write is limited to MIFARE Classic.");
    } else {
      byte data[16];
      String errorMessage;
      if (readDataBlock(data, errorMessage)) {
        sendReadResult(true, "Block 4 read successfully.", data);
      } else {
        sendReadResult(false, errorMessage);
      }
    }
    pendingAction = ACTION_NONE;
  }
  else if (pendingAction == ACTION_WRITE) {
    if (!isMifareClassic(type)) {
      sendWriteResult(false, "Card detected, but memory read/write is limited to MIFARE Classic.");
    } else {
      byte verified[16];
      String errorMessage;
      if (writeDataBlock(pendingWriteText, verified, errorMessage)) {
        sendWriteResult(true, "Write successful and verified.", verified);
      } else {
        sendWriteResult(false, errorMessage);
      }
    }
    pendingAction = ACTION_NONE;
    pendingWriteText = "";
  }

  finishCardTransaction();
}

// ============================================================
// Setup / loop
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(700);

  for (byte i = 0; i < 6; i++) mifareKey.keyByte[i] = 0xFF;

  SPI.begin(SPI_SCK_PIN, SPI_MISO_PIN, SPI_MOSI_PIN, RFID_SS_PIN);
  rfid.PCD_Init();
  delay(100);

  const byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (version == 0x00 || version == 0xFF) {
    sendError("MFRC522 not detected. Check SPI wiring and 3.3V power.");
  } else {
    rfid.PCD_SetAntennaGain(rfid.RxGain_max);
    sendReady();
  }
}

void loop() {
  processSerialCommands();
  handleRFID();
  delay(2);
}
