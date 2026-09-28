/*
  Air780E / Air780EU cellular LBS location extension for Dallmayr Telemetry V6.8.47

  Purpose
  -------
  The production board has no GNSS receiver. This module obtains an approximate
  position from the cellular network using the Air780E AT firmware's free
  single-cell LBS command (AT+CIPGSMLOC=1,1), caches the fix, and publishes it
  through the existing Supabase location_update ingest path.

  Design constraints
  ------------------
  - The SIM/modem must be registered on the cellular network.
  - UART1 is raw PPP data while PPPoS is online, so an LBS refresh uses a short,
    controlled PPP maintenance window, then restores PPP when it was active.
  - LBS is refreshed at most every 6 hours during normal operation. The cached
    fix can still be uploaded at the database-selected location interval.
  - A failed LBS lookup is retried no faster than every 30 minutes.
  - No latitude/longitude is invented. Manual 0/0 fallback remains disabled.
  - Existing MDB/DEX capture and cup counters are untouched.

  Arduino-ESP32 calls serialEventRun() after every loop() iteration. Defining it
  here provides a non-invasive extension point so the proven V6.8.47 primary
  sketch does not need to be duplicated or rewritten.
*/

struct CellularLbsFix {
  bool valid = false;
  double latitude = 0.0;
  double longitude = 0.0;
  uint32_t acquiredAtMs = 0;
  int resultCode = -1;
  char rawDate[11] = {0};
  char rawTime[9] = {0};
};

static CellularLbsFix cellularLbsFix;
static uint32_t cellularLbsLastAttemptMs = 0;
static uint32_t cellularLbsLastUploadMs = 0;
static uint32_t cellularLbsBootReadyAtMs = 60000UL;
static bool cellularLbsRefreshBusy = false;

static const uint32_t CELLULAR_LBS_REFRESH_MS = 6UL * 60UL * 60UL * 1000UL;
static const uint32_t CELLULAR_LBS_FAILED_RETRY_MS = 30UL * 60UL * 1000UL;
static const uint32_t CELLULAR_LBS_QUERY_TIMEOUT_MS = 45000UL;

static bool cellularLbsCoordinateValid(double latitude, double longitude) {
  return isfinite(latitude) && isfinite(longitude)
      && latitude >= -90.0 && latitude <= 90.0
      && longitude >= -180.0 && longitude <= 180.0
      && !(latitude == 0.0 && longitude == 0.0);
}

static String cellularLbsCsvField(const String& line, uint8_t wantedIndex) {
  uint8_t fieldIndex = 0;
  int start = 0;
  for (int i = 0; i <= line.length(); ++i) {
    if (i == line.length() || line.charAt(i) == ',') {
      if (fieldIndex == wantedIndex) {
        String value = line.substring(start, i);
        value.trim();
        return value;
      }
      fieldIndex++;
      start = i + 1;
    }
  }
  return "";
}

static bool parseCellularLbsResponse(const String& response, CellularLbsFix& parsed) {
  int marker = response.indexOf("+CIPGSMLOC:");
  if (marker < 0) return false;

  int lineEnd = response.indexOf('\n', marker);
  if (lineEnd < 0) lineEnd = response.length();
  String line = response.substring(marker + 12, lineEnd);
  line.trim();

  String resultText = cellularLbsCsvField(line, 0);
  String latitudeText = cellularLbsCsvField(line, 1);
  String longitudeText = cellularLbsCsvField(line, 2);
  String dateText = cellularLbsCsvField(line, 3);
  String timeText = cellularLbsCsvField(line, 4);

  int result = resultText.toInt();
  parsed.resultCode = result;
  if (result != 0 || !latitudeText.length() || !longitudeText.length()) return false;

  char* latitudeEnd = nullptr;
  char* longitudeEnd = nullptr;
  double latitude = strtod(latitudeText.c_str(), &latitudeEnd);
  double longitude = strtod(longitudeText.c_str(), &longitudeEnd);
  if (!latitudeEnd || *latitudeEnd != '\0' || !longitudeEnd || *longitudeEnd != '\0') return false;
  if (!cellularLbsCoordinateValid(latitude, longitude)) return false;

  parsed.latitude = latitude;
  parsed.longitude = longitude;
  parsed.valid = true;
  parsed.acquiredAtMs = millis();
  copyText(parsed.rawDate, sizeof(parsed.rawDate), dateText);
  copyText(parsed.rawTime, sizeof(parsed.rawTime), timeText);
  return true;
}

static bool prepareCellularLbsBearer() {
  // OpenLuat documents SAPBR bearer setup before CIPGSMLOC. This is performed
  // only while the modem is in AT command mode; PPP is never sharing UART1.
  if (!cellCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", "OK", 4000)) return false;

  String locationApn = apn.length() ? apn : String(DEFAULT_APN);
  String apnCommand = String("AT+SAPBR=3,1,\"APN\",\"") + locationApn + "\"";
  if (!cellCommand(apnCommand, "OK", 4000)) return false;

  String bearerStatus = cellQueryText("AT+SAPBR=2,1", 4000);
  bool alreadyActive = bearerStatus.indexOf("+SAPBR: 1,1,") >= 0;
  if (!alreadyActive) {
    if (!cellCommand("AT+SAPBR=1,1", "OK", 18000)) return false;
    bearerStatus = cellQueryText("AT+SAPBR=2,1", 4000);
  }

  if (bearerStatus.indexOf("+SAPBR: 1,1,") < 0) {
    Serial.println(F("Cellular LBS bearer did not obtain an IP address."));
    return false;
  }
  return true;
}

static void closeCellularLbsBearer() {
  // The production data path uses raw lwIP PPPoS, not SAPBR. Close the temporary
  // LBS bearer before redialling PPP so the two data-session models never overlap.
  cellCommand("AT+SAPBR=0,1", "OK", 10000, true);
}

static bool queryCellularLbsAtMode() {
  cellularLbsLastAttemptMs = millis();

  if (!cellModemRegistered) {
    Serial.println(F("Cellular LBS skipped: modem is not registered."));
    return false;
  }
  if (pppStarted || pppOnline) {
    Serial.println(F("Cellular LBS internal guard: PPP still owns UART1."));
    return false;
  }

  Serial.println(F("Requesting approximate location from Air780E cellular LBS..."));
  if (!prepareCellularLbsBearer()) {
    Serial.println(F("Cellular LBS failed while preparing the temporary data bearer."));
    closeCellularLbsBearer();
    return false;
  }

  cellDrain();
  CellSerial.print("AT+CIPGSMLOC=1,1\r\n");
  String response = cellReadUntil(
    CELLULAR_LBS_QUERY_TIMEOUT_MS,
    "\r\nOK\r\n",
    "\r\nERROR\r\n",
    false,
    "+CME ERROR:"
  );

  CellularLbsFix candidate;
  bool parsed = parseCellularLbsResponse(response, candidate);
  closeCellularLbsBearer();

  if (!parsed) {
    int marker = response.indexOf("+CIPGSMLOC:");
    if (marker >= 0) {
      int lineEnd = response.indexOf('\n', marker);
      if (lineEnd < 0) lineEnd = response.length();
      String resultLine = response.substring(marker, lineEnd);
      resultLine.trim();
      Serial.print(F("Cellular LBS did not return a usable fix: "));
      Serial.println(resultLine);
    } else {
      Serial.println(F("Cellular LBS lookup timed out or returned no location result."));
    }
    return false;
  }

  cellularLbsFix = candidate;
  Serial.print(F("Cellular LBS fix acquired lat="));
  Serial.print(cellularLbsFix.latitude, 6);
  Serial.print(F(" lon="));
  Serial.println(cellularLbsFix.longitude, 6);
  Serial.println(F("Location source is approximate cellular tower/LBS, not GNSS."));
  return true;
}

static bool refreshCellularLbs(bool force) {
  if (cellularLbsRefreshBusy) return false;
  if (!policy.locationEnabled || !policy.cellularEnabled) return false;

  uint32_t now = millis();
  if (!force) {
    if (cellularLbsFix.valid && cellularLbsFix.acquiredAtMs != 0
        && now - cellularLbsFix.acquiredAtMs < CELLULAR_LBS_REFRESH_MS) {
      return true;
    }
    if (cellularLbsLastAttemptMs != 0
        && now - cellularLbsLastAttemptMs < CELLULAR_LBS_FAILED_RETRY_MS) {
      return cellularLbsFix.valid;
    }
  }

  cellularLbsRefreshBusy = true;
  bool hadPpp = pppStarted || pppOnline;

  if (hadPpp) {
    Serial.println(F("Cellular LBS refresh: pausing PPP for an AT-command maintenance window."));
    stopCellularPpp(true);
    cellModemRegistered = false;
  }

  bool registered = cellModemRegistered;
  if (!registered) registered = initializeCellular();

  bool fixed = registered && queryCellularLbsAtMode();

  if (hadPpp) {
    Serial.println(F("Cellular LBS refresh complete; restoring PPP data service."));
    if (!registered || !startCellularPpp()) {
      cellModemRegistered = false;
      cellReady = false;
      pppOnline = false;
      lastCellAttemptMs = 0;
      Serial.println(F("PPP restore after LBS did not complete; normal cellular maintenance will retry."));
    }
  }

  cellularLbsRefreshBusy = false;
  return fixed;
}

static bool uploadCellularLbsLocation() {
  if (!cellularLbsFix.valid || !deviceEnrolled() || !policy.locationEnabled) return false;
  if (!anyDataTransportReady()) return false;

  JsonDocument doc;
  addCommonPayload(doc, "location_update");
  JsonObject location = doc["location"].to<JsonObject>();
  location["latitude"] = cellularLbsFix.latitude;
  location["longitude"] = cellularLbsFix.longitude;
  location["source"] = "cellular_lbs";
  location["positioning"] = "single_cell";
  location["accuracy_class"] = "approximate";
  if (cellularOperator.length()) location["operator"] = cellularOperator;
  if (cellularCsq >= 0) location["cellular_csq"] = cellularCsq;
  if (cellularLbsFix.rawDate[0]) location["lbs_date"] = cellularLbsFix.rawDate;
  if (cellularLbsFix.rawTime[0]) location["lbs_time"] = cellularLbsFix.rawTime;

  bool ok = sendDocumentToIngest(doc);
  if (ok) {
    uint32_t now = millis();
    cellularLbsLastUploadMs = now;
    // Share the existing scheduler anchor so V6.8.47's GNSS/manual service does
    // not immediately attempt a duplicate location_update.
    lastLocationUploadMs = now;
    policy.locationDue = false;
    Serial.println(F("Location uploaded source=cellular_lbs (SIM/cell-tower network)."));
  }
  return ok;
}

static void serviceCellularLbsLocation() {
  if (!deviceEnrolled() || !policy.locationEnabled || !policy.cellularEnabled) return;
  if (gnssFix.valid) return;  // A real GNSS fix is more precise when hardware is fitted.

  uint32_t now = millis();
  if (now < cellularLbsBootReadyAtMs) return;

  uint32_t uploadMinutes = policy.locationIntervalMinutes == 0
    ? 15 : policy.locationIntervalMinutes;
  uint32_t uploadIntervalMs = uploadMinutes * 60000UL;
  bool uploadDue = policy.locationDue
    || cellularLbsLastUploadMs == 0
    || now - cellularLbsLastUploadMs >= uploadIntervalMs;
  if (!uploadDue) return;

  bool refreshDue = !cellularLbsFix.valid
    || cellularLbsFix.acquiredAtMs == 0
    || now - cellularLbsFix.acquiredAtMs >= CELLULAR_LBS_REFRESH_MS;

  if (refreshDue) refreshCellularLbs(false);
  if (cellularLbsFix.valid) uploadCellularLbsLocation();
}

void serialEventRun(void) {
  // Called by Arduino-ESP32 immediately after loop(). Keep this routine cheap
  // except when a scheduled LBS maintenance window is actually due.
  serviceCellularLbsLocation();
}
