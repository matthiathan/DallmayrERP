/*
  Air780E / Air780EU cellular LBS location extension for Dallmayr Telemetry V6.8.52

  This module obtains an approximate position from the cellular network using
  the Air780E AT firmware's free single-cell LBS command (AT+CIPGSMLOC=1,1),
  caches the fix, and publishes it through the existing Supabase location_update
  ingest path. The production board therefore does not require GNSS hardware for
  approximate machine positioning.

  UART1 is raw PPP data while PPPoS is online, so a location refresh uses a
  controlled AT-command maintenance window and restores PPP afterwards. Normal
  LBS refresh is capped at once every 6 hours; a failed lookup retries no faster
  than every 30 minutes. Cached coordinates can still be reported at the
  database-selected location interval.
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
static const uint32_t CELLULAR_LBS_BOOT_READY_MS = 60000UL;
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

static bool parseCellularLbsResponse(
  const String& response,
  double& latitudeOut,
  double& longitudeOut,
  int& resultCodeOut,
  String& dateOut,
  String& timeOut
) {
  int marker = response.indexOf("+CIPGSMLOC:");
  if (marker < 0) return false;

  int lineEnd = response.indexOf('\n', marker);
  if (lineEnd < 0) lineEnd = response.length();
  String line = response.substring(marker + 12, lineEnd);
  line.trim();

  String resultText = cellularLbsCsvField(line, 0);
  String latitudeText = cellularLbsCsvField(line, 1);
  String longitudeText = cellularLbsCsvField(line, 2);
  dateOut = cellularLbsCsvField(line, 3);
  timeOut = cellularLbsCsvField(line, 4);

  int result = resultText.toInt();
  resultCodeOut = result;
  if (result != 0 || !latitudeText.length() || !longitudeText.length()) return false;

  char* latitudeEnd = nullptr;
  char* longitudeEnd = nullptr;
  double latitude = strtod(latitudeText.c_str(), &latitudeEnd);
  double longitude = strtod(longitudeText.c_str(), &longitudeEnd);
  if (!latitudeEnd || *latitudeEnd != '\0' || !longitudeEnd || *longitudeEnd != '\0') return false;
  if (!cellularLbsCoordinateValid(latitude, longitude)) return false;

  latitudeOut = latitude;
  longitudeOut = longitude;
  return true;
}

static bool prepareCellularLbsBearer() {
  if (!cellCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", "OK", 4000)) return false;

  String locationApn = apn.length() ? apn : String(DEFAULT_APN);
  String apnCommand = String("AT+SAPBR=3,1,\"APN\",\"") + locationApn + "\"";
  if (!cellCommand(apnCommand, "OK", 4000)) return false;

  String bearerStatus = cellQueryText("AT+SAPBR=2,1", 4000);
  if (bearerStatus.indexOf("+SAPBR: 1,1,") < 0) {
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

  double latitude = 0.0;
  double longitude = 0.0;
  int resultCode = -1;
  String dateText;
  String timeText;
  bool parsed = parseCellularLbsResponse(
    response,
    latitude,
    longitude,
    resultCode,
    dateText,
    timeText
  );
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

  cellularLbsFix.valid = true;
  cellularLbsFix.latitude = latitude;
  cellularLbsFix.longitude = longitude;
  cellularLbsFix.resultCode = resultCode;
  cellularLbsFix.acquiredAtMs = millis();
  copyText(cellularLbsFix.rawDate, sizeof(cellularLbsFix.rawDate), dateText);
  copyText(cellularLbsFix.rawTime, sizeof(cellularLbsFix.rawTime), timeText);

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
    lastLocationUploadMs = now;
    policy.locationDue = false;
    Serial.println(F("Location uploaded source=cellular_lbs (SIM/cell-tower network)."));
  }
  return ok;
}

static void serviceCellularLbsLocation() {
  if (!deviceEnrolled() || !policy.locationEnabled || !policy.cellularEnabled) return;
  if (gnssFix.valid) return;

  uint32_t now = millis();
  if (now < CELLULAR_LBS_BOOT_READY_MS) return;

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
  serviceCellularLbsLocation();
}
