from pathlib import Path

src = Path("firmware/DallmayrTelemetryV6_8_46/DallmayrTelemetryV6_8_46.ino")
dst = Path("firmware/DallmayrTelemetryV6_8_47/DallmayrTelemetryV6_8_47.ino")
text = src.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    text = text.replace(old, new, 1)


replace_once(
    "Dallmayr South Africa - Telemetry V6.8.46 DB-POLICY NATIVE MDB + DEX",
    "Dallmayr South Africa - Telemetry V6.8.47 DB-POLICY NATIVE MDB + DEX",
    "header version",
)
replace_once(
    'static const char* FIRMWARE_VERSION = "6.8.46-esp32s3-air780eu-mdb-fault-recovery";',
    'static const char* FIRMWARE_VERSION = "6.8.47-esp32s3-air780eu-stale-ppp-recovery";',
    "firmware version",
)

replace_once(
    "static const uint32_t PPP_CONNECT_TIMEOUT_MS = 120000UL;\n",
    "static const uint32_t PPP_CONNECT_TIMEOUT_MS = 120000UL;\n"
    "// A prepaid carrier can leave PPP logically UP with an assigned IP while\n"
    "// Internet routing is blocked. Three consecutive HTTPS attempts that fail\n"
    "// before receiving any HTTP response therefore trigger a controlled PPP\n"
    "// teardown/redial. The cooldown prevents a Supabase or Internet outage from\n"
    "// turning into a modem reset loop.\n"
    "static const uint8_t CELLULAR_HTTPS_FAILURE_RECOVERY_THRESHOLD = 3;\n"
    "static const uint32_t CELLULAR_STALE_PPP_RECOVERY_COOLDOWN_MS = 5UL * 60UL * 1000UL;\n",
    "cellular watchdog constants",
)

replace_once(
    "volatile bool pppOnline = false;\nuint32_t pppStartedAtMs = 0;\n",
    "volatile bool pppOnline = false;\nuint32_t pppStartedAtMs = 0;\n"
    "uint8_t consecutiveCellularHttpsFailures = 0;\n"
    "uint32_t lastCellularHttpsSuccessMs = 0;\n"
    "uint32_t lastStalePppRecoveryMs = 0;\n"
    "uint32_t stalePppRecoveryCount = 0;\n"
    "bool stalePppRecoveryPending = false;\n",
    "cellular watchdog state",
)

replace_once(
    "bool ensureCellularPpp() {\n"
    "  if (airPppHasIp()) {\n"
    "    pppOnline = true;\n"
    "    cellReady = true;\n"
    "    return true;\n"
    "  }\n\n"
    "  if (pppStarted || airPppPcb != nullptr) {\n"
    "    stopCellularPpp(true);\n"
    "    cellModemRegistered = false;\n"
    "  }\n\n"
    "  if (!cellModemRegistered && !initializeCellular()) return false;\n"
    "  return startCellularPpp();\n"
    "}\n\n"
    "void maintainCellular() {",
    "bool ensureCellularPpp() {\n"
    "  if (airPppHasIp()) {\n"
    "    pppOnline = true;\n"
    "    cellReady = true;\n"
    "    return true;\n"
    "  }\n\n"
    "  if (pppStarted || airPppPcb != nullptr) {\n"
    "    stopCellularPpp(true);\n"
    "    cellModemRegistered = false;\n"
    "  }\n\n"
    "  if (!cellModemRegistered && !initializeCellular()) return false;\n"
    "  return startCellularPpp();\n"
    "}\n\n"
    "void noteCellularHttpsResult(int statusCode) {\n"
    "  if (statusCode > 0) {\n"
    "    if (consecutiveCellularHttpsFailures > 0) {\n"
    "      Serial.print(F(\"Cellular Internet recovered after HTTPS failures: \"));\n"
    "      Serial.println(consecutiveCellularHttpsFailures);\n"
    "    }\n"
    "    consecutiveCellularHttpsFailures = 0;\n"
    "    stalePppRecoveryPending = false;\n"
    "    lastCellularHttpsSuccessMs = millis();\n"
    "    return;\n"
    "  }\n\n"
    "  // Only count failures while lwIP still believes PPP owns a valid IPv4\n"
    "  // address. This distinguishes a stale routed session from an ordinary PPP\n"
    "  // negotiation failure, which maintainCellular() already handles.\n"
    "  if (!pppStarted || !airPppHasIp()) return;\n"
    "  if (consecutiveCellularHttpsFailures < 255) consecutiveCellularHttpsFailures++;\n\n"
    "  Serial.print(F(\"Cellular HTTPS no-response streak: \"));\n"
    "  Serial.print(consecutiveCellularHttpsFailures);\n"
    "  Serial.print('/');\n"
    "  Serial.println(CELLULAR_HTTPS_FAILURE_RECOVERY_THRESHOLD);\n\n"
    "  if (consecutiveCellularHttpsFailures < CELLULAR_HTTPS_FAILURE_RECOVERY_THRESHOLD) return;\n\n"
    "  uint32_t now = millis();\n"
    "  bool cooldownExpired = lastStalePppRecoveryMs == 0\n"
    "    || now - lastStalePppRecoveryMs >= CELLULAR_STALE_PPP_RECOVERY_COOLDOWN_MS;\n"
    "  if (!cooldownExpired) {\n"
    "    Serial.println(F(\"Stale PPP recovery threshold reached, but recovery cooldown is active.\"));\n"
    "    return;\n"
    "  }\n\n"
    "  stalePppRecoveryPending = true;\n"
    "  // Stop advertising the transport as ready immediately. The controlled\n"
    "  // teardown happens from maintainCellular(), outside the HTTP call stack.\n"
    "  pppOnline = false;\n"
    "  cellReady = false;\n"
    "  Serial.println(F(\"PPP still has an IP but Internet HTTPS is unreachable; scheduling PPP redial.\"));\n"
    "}\n\n"
    "void serviceStalePppRecovery() {\n"
    "  if (!stalePppRecoveryPending) return;\n\n"
    "  stalePppRecoveryPending = false;\n"
    "  lastStalePppRecoveryMs = millis();\n"
    "  stalePppRecoveryCount++;\n"
    "  Serial.print(F(\"Recovering stale cellular PPP session; recovery #\"));\n"
    "  Serial.println(stalePppRecoveryCount);\n\n"
    "  // Preserve NVS, cup counters and telemetry queues. Only the cellular data\n"
    "  // session is torn down. stopCellularPpp(true) performs the guarded +++/ATH\n"
    "  // command-mode recovery before the next APN registration/dial attempt.\n"
    "  stopCellularPpp(true);\n"
    "  cellModemRegistered = false;\n"
    "  pppOnline = false;\n"
    "  cellReady = false;\n"
    "  uint32_t now = millis();\n"
    "  lastCellAttemptMs = now > CELL_RETRY_MS ? now - CELL_RETRY_MS : 0;\n"
    "}\n\n"
    "void maintainCellular() {",
    "cellular recovery helpers",
)

replace_once(
    "  if (wifiIsPrimary && !pppStarted && wifiBeginIssued && wifiConnectionStartedMs != 0\n"
    "      && millis() - wifiConnectionStartedMs < WIFI_PRIMARY_GRACE_MS) {\n"
    "    return;\n"
    "  }\n\n"
    "  if (pppOnline || pppStarted) {",
    "  if (wifiIsPrimary && !pppStarted && wifiBeginIssued && wifiConnectionStartedMs != 0\n"
    "      && millis() - wifiConnectionStartedMs < WIFI_PRIMARY_GRACE_MS) {\n"
    "    return;\n"
    "  }\n\n"
    "  // A stale PPP session can retain its IPv4 address after a prepaid bundle\n"
    "  // is exhausted. Process Internet-health recovery before trusting that IP.\n"
    "  if (stalePppRecoveryPending) serviceStalePppRecovery();\n\n"
    "  if (pppOnline || pppStarted) {",
    "maintain cellular stale recovery",
)

replace_once(
    "  statusCode = http.POST(json);\n"
    "  if (statusCode > 0) responseBody = http.getString();\n"
    "  if (statusCode > 0) recordApplicationTransfer(\"cellular\", json.length(), responseBody.length());\n"
    "  http.end();\n\n"
    "  if (statusCode <= 0) {",
    "  statusCode = http.POST(json);\n"
    "  if (statusCode > 0) responseBody = http.getString();\n"
    "  if (statusCode > 0) recordApplicationTransfer(\"cellular\", json.length(), responseBody.length());\n"
    "  http.end();\n\n"
    "  // Any HTTP response proves that the PDP/PPP route is usable, even if the\n"
    "  // application status is 4xx/5xx. Only no-response transport failures feed\n"
    "  // the stale-PPP watchdog.\n"
    "  noteCellularHttpsResult(statusCode);\n\n"
    "  if (statusCode <= 0) {",
    "PPP HTTPS health hook",
)

# Add a concise boot/status marker without depending on the exact printStatus layout.
replace_once(
    '  Serial.println(F("ESP32 NetworkClientSecure now carries Supabase TLS over raw lwIP PPPoS."));\n',
    '  Serial.println(F("ESP32 NetworkClientSecure now carries Supabase TLS over raw lwIP PPPoS."));\n'
    '  Serial.print(F("Cellular HTTPS watchdog: "));\n'
    '  Serial.print(CELLULAR_HTTPS_FAILURE_RECOVERY_THRESHOLD);\n'
    '  Serial.print(F(" failures, cooldown "));\n'
    '  Serial.print(CELLULAR_STALE_PPP_RECOVERY_COOLDOWN_MS / 60000UL);\n'
    '  Serial.println(F(" minute(s)"));\n',
    "PPP connected watchdog marker",
)

dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(text, encoding="utf-8")
print(dst)
