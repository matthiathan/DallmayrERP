#pragma once
#include "FirmwareTrust.h"
#include "OtaBootPolicy.h"
#include <esp_ota_ops.h>
#include <esp_task_wdt.h>
#include <nvs.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

// A failed/unverified application must be rolled back by the bootloader, including
// failures before setup(). Defining a sketch macro cannot enable this in a
// prebuilt bootloader: provision the rollback-enabled bootloader over USB first.
static bool otaRollbackCapable() {
#if defined(CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE) && CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE
  return esp_ota_get_next_update_partition(nullptr) != nullptr && esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_OTA, nullptr) != nullptr;
#else
  return false;
#endif
}
static bool otaTrustReady() { return strlen(DALLMAYR_OTA_PUBLIC_KEY_PEM) > 100 && strlen(DALLMAYR_OTA_CA_PEM) > 100; }
static String otaJob, otaStatus = "idle", otaDetail, otaVersion, otaHash, otaUrl, otaSignature;
static uint32_t otaTargetAddress = 0;
static uint32_t otaGeneration = 0, otaHighWater = 0, otaSize = 0, otaWritten = 0;
static uint32_t otaStartedMs = 0, otaLastByteMs = 0, otaLastReportMs = 0, otaBootMs = 0;
static bool otaOwnWatchdog = false;
static bool otaPendingVerify = false, otaQueued = false, otaReportDirty = false;
static uint8_t otaHealthyHeartbeats = 0;
static NetworkClientSecure otaTls;
static HTTPClient otaHttp;
static esp_ota_handle_t otaHandle = 0;
static const esp_partition_t* otaPartition = nullptr;
static mbedtls_sha256_context otaDigest;
static bool otaDigestStarted = false;

static bool otaSaveStatus() {
  JsonDocument state;
  state["job"]=otaJob; state["status"]=otaStatus; state["detail"]=otaDetail;
  state["target_address"]=otaTargetAddress; state["version"]=otaVersion; state["generation"]=otaGeneration; state["highwater"]=otaHighWater;
  String encoded; serializeJson(state,encoded);
  if (!prefs.begin("dallmayr_ota", false)) return false;
  size_t stored=prefs.putString("state",encoded);
  bool verified=prefs.getString("state", "")==encoded;
  prefs.end();
  otaReportDirty = true;
  return stored==encoded.length() && verified;
}
static void otaFail(const char* reason, const char* status = "failed") {
  if (otaHandle) { esp_ota_abort(otaHandle); otaHandle = 0; }
  if (otaDigestStarted) { mbedtls_sha256_free(&otaDigest); otaDigestStarted = false; }
  otaHttp.end();
  otaQueued = false;
  otaStatus = status;
  otaDetail = reason;
  otaSaveStatus();
}
static bool otaHex(const String& text, uint8_t* out, size_t size) {
  if (text.length() != size * 2) return false;
  for (size_t i=0; i<size; ++i) {
    char a=text[i*2], b=text[i*2+1];
    auto digit=[](char c)->int { return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1; };
    int hi=digit(a), lo=digit(b);
    if (hi<0 || lo<0) return false;
    out[i]=uint8_t(hi*16+lo);
  }
  return true;
}
static bool otaVerifyManifest() {
  if (!otaGeneration || otaGeneration > 2147483647U || otaGeneration <= otaHighWater || !otaSize || otaSize > 6291456 || !otaVersion.length() || otaVersion.length()>96) return false;
  for (size_t i=0;i<otaVersion.length();++i) {
    char c=otaVersion[i];
    if (!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='.'||c=='_'||c=='-')) return false;
  }
  uint8_t expected[32], signature[80], digest[32];
  size_t signatureSize=otaSignature.length()/2;
  if (signatureSize<68 || signatureSize>72 || !otaHex(otaSignature,signature,signatureSize) || !otaHex(otaHash,expected,32)) return false;
  String canonical=String("DALLMAYR-OTA-1\nesp32s3-n16r8\n")+String(otaGeneration)+"\n"+otaVersion+"\n"+String(otaSize)+"\n"+otaHash+"\n";
  if (mbedtls_sha256(reinterpret_cast<const unsigned char*>(canonical.c_str()),canonical.length(),digest,0)!=0) return false;
  mbedtls_pk_context key;
  mbedtls_pk_init(&key);
  int parsed=mbedtls_pk_parse_public_key(&key,reinterpret_cast<const unsigned char*>(DALLMAYR_OTA_PUBLIC_KEY_PEM),strlen(DALLMAYR_OTA_PUBLIC_KEY_PEM)+1);
  bool valid=parsed==0 && mbedtls_pk_can_do(&key,MBEDTLS_PK_ECDSA) && mbedtls_pk_get_bitlen(&key)==256 && mbedtls_pk_verify(&key,MBEDTLS_MD_SHA256,digest,sizeof(digest),signature,signatureSize)==0;
  mbedtls_pk_free(&key);
  return valid;
}
void otaAcceptConfig(JsonVariantConst manifest) {
  if (manifest.isNull() || otaQueued || otaHandle || otaPendingVerify) return;
  String job=manifest["job_id"] | "";
  if (!job.length() || job.length()>40 || job==otaJob) return;
  otaJob=job;
  otaGeneration=manifest["generation"] | 0U;
  otaSize=manifest["size"] | 0U;
  otaVersion=String(manifest["version"] | "");
  otaHash=String(manifest["sha256"] | "");
  otaUrl=String(manifest["url"] | "");
  otaSignature=String(manifest["signature"] | "");
  if (!otaRollbackCapable()) { otaFail("Rollback-enabled bootloader and two app slots are required.","rejected"); return; }
  if (!otaTrustReady()) { otaFail("Release verification key and HTTPS CA are not provisioned.","rejected"); return; }
  String origin=String(CONFIG_URL);
  int functions=origin.indexOf("/functions/v1/");
  if (functions<0) { otaFail("Invalid backend origin.","rejected"); return; }
  origin=origin.substring(0,functions);
  if (String(manifest["target"] | "")!="esp32s3-n16r8" || !otaUrl.startsWith(origin+"/storage/v1/object/sign/telemetry-firmware/") || !otaVerifyManifest()) {
    otaFail("Manifest signature, target, generation or download origin is invalid.","rejected"); return;
  }
  if (!otaRollbackCapable() || !otaTrustReady()) { otaFail("Rollback bootloader or public trust anchors are not provisioned.","rejected"); return; }
  otaQueued=true;
  otaStatus="installing";
  otaDetail="Signed release accepted; preparing inactive app slot.";
  otaSaveStatus();
}
void otaAddStatus(JsonDocument& doc) {
  JsonObject out=doc["firmware_update"].to<JsonObject>();
  out["job_id"]=otaJob;
  out["status"]=otaStatus;
  out["detail"]=otaDetail;
  out["generation"]=otaGeneration;
  out["highwater"]=otaHighWater;
  out["running_version"]=FIRMWARE_VERSION;
  out["rollback_capable"]=otaRollbackCapable();
  out["trust_ready"]=otaTrustReady();
}
void otaBootStart() {
  otaBootMs=millis();
  nvs_handle_t store;
  esp_err_t opened=nvs_open("dallmayr_ota",NVS_READONLY,&store);
  bool storageValid=true;
  if (opened==ESP_OK) {
    size_t length=0;
    esp_err_t sized=nvs_get_str(store,"state",nullptr,&length);
    char saved[2048];
    if (sized!=ESP_OK || length==0 || length>sizeof(saved) || nvs_get_str(store,"state",saved,&length)!=ESP_OK) {
      storageValid=false;
    } else {
      JsonDocument stored;
      if (deserializeJson(stored,saved) || !stored["highwater"].is<uint32_t>() || !stored["generation"].is<uint32_t>()) storageValid=false;
      else {
        otaJob=String(stored["job"] | ""); otaStatus=String(stored["status"] | "idle");
        otaDetail=String(stored["detail"] | ""); otaVersion=String(stored["version"] | "");
        otaTargetAddress=stored["target_address"] | 0U;
        otaGeneration=stored["generation"] | 0U; otaHighWater=stored["highwater"] | 0U;
      }
    }
    nvs_close(store);
  } else if (opened!=ESP_ERR_NVS_NOT_FOUND) storageValid=false;
  // Only a genuinely absent namespace is first use. Read failures never reset
  // replay protection; require USB maintenance instead of accepting an old image.
  if (!storageValid) {
    otaHighWater=2147483647U; otaStatus="rejected";
    otaDetail="OTA storage is unreadable; USB maintenance required.";
  }
  esp_ota_img_states_t state=ESP_OTA_IMG_UNDEFINED;
  auto running=esp_ota_get_running_partition();
  bool stateKnown=running && esp_ota_get_state_partition(running,&state)==ESP_OK;
  otaPendingVerify=stateKnown && state==ESP_OTA_IMG_PENDING_VERIFY;
  bool confirmedTarget=stateKnown && state==ESP_OTA_IMG_VALID && otaHighWater>=otaGeneration
    && otaGeneration>0 && running->address==otaTargetAddress;
  String recovered=otaRecoveredStatus(otaStatus.c_str(),otaPendingVerify,confirmedTarget);
  if (otaPendingVerify) {
    esp_task_wdt_config_t watchdog={}; watchdog.timeout_ms=120000;
    watchdog.idle_core_mask=(1U<<portNUM_PROCESSORS)-1; watchdog.trigger_panic=true;
    esp_err_t configured=esp_task_wdt_reconfigure(&watchdog);
    if (configured==ESP_ERR_INVALID_STATE) configured=esp_task_wdt_init(&watchdog);
    if (configured!=ESP_OK || (!otaJob.length()) || !otaGeneration) {
      esp_ota_mark_app_invalid_rollback_and_reboot(); return;
    }
    if (esp_task_wdt_status(nullptr)!=ESP_OK) {
      otaOwnWatchdog=esp_task_wdt_add(nullptr)==ESP_OK;
      if (!otaOwnWatchdog) { esp_ota_mark_app_invalid_rollback_and_reboot(); return; }
    }
    otaDetail="Waiting for stable startup and two acknowledged heartbeats.";
  } else if (recovered!=otaStatus) {
    otaDetail=recovered=="failed" ? "Download interrupted before trial boot; current firmware retained."
      : recovered=="healthy" ? "Confirmed image retained after an interrupted final acknowledgement."
      : "Previous firmware resumed after an unsuccessful trial.";
  }
  if (recovered!=otaStatus || otaPendingVerify) { otaStatus=recovered; otaSaveStatus(); }

}
void otaRecordHealth() {
  if (!otaPendingVerify) return;
  if (otaHealthyHeartbeats<2) ++otaHealthyHeartbeats;
  if (otaHealthyHeartbeats>=2 && millis()-otaBootMs>=60000UL && ESP.getFreeHeap()>32768
      && (!DALLMAYR_MACHINE_IO_ENABLED || machineInterface!=IFACE_DISABLED)) {
    // Commit replay protection before making the trial permanent. A reset after
    // this write is recoverable using the target partition and bootloader state.
    otaHighWater=otaGeneration;
    if (!otaSaveStatus()) { esp_ota_mark_app_invalid_rollback_and_reboot(); return; }
    if (esp_ota_mark_app_valid_cancel_rollback()==ESP_OK) {
      otaPendingVerify=false;
      if (otaOwnWatchdog) { esp_task_wdt_delete(nullptr); otaOwnWatchdog=false; }
      otaStatus="healthy"; otaDetail="Trial firmware confirmed after stable startup and backend acknowledgements.";
      otaSaveStatus();
    }
  }
}
void serviceFirmwareUpdate() {
  uint32_t now=millis();
  if (otaPendingVerify) esp_task_wdt_reset();
  if (otaPendingVerify && now-otaBootMs>300000UL) {
    otaStatus="rolled_back"; otaDetail="New firmware did not pass its five-minute startup health check."; otaSaveStatus();
    esp_ota_mark_app_invalid_rollback_and_reboot();
    return;
  }
  // Status is acknowledged independently from sales reporting and retried.
  if (otaReportDirty && deviceEnrolled() && anyDataTransportReady() && (otaLastReportMs==0 || now-otaLastReportMs>=30000UL)) {
    otaLastReportMs=now;
    JsonDocument report; addCommonPayload(report,"firmware_update_status"); otaAddStatus(report);
    if (sendDocumentToIngest(report)) otaReportDirty=false;
  }
  if (!otaQueued && !otaHandle) return;
  if (otaQueued) {
    // Report installing before starting a potentially long transfer.
    if (otaReportDirty) return;
    otaPartition=esp_ota_get_next_update_partition(nullptr);
    otaTargetAddress=otaPartition ? otaPartition->address : 0;
    if (!otaPartition || otaSize>otaPartition->size) { otaFail("Release does not fit inactive application slot."); return; }
    if (cellularRouting.preferCellular(now) && pppOnline && airPppHasIp()) {
      if (!selectAirPppAsDefault()) return;
    } else if (wifiReady()) Network.setDefaultInterface(WiFi.STA);
    else if (pppOnline && airPppHasIp()) { if (!selectAirPppAsDefault()) return; }
    else return;
    otaTls.setCACert(DALLMAYR_OTA_CA_PEM);
    otaHttp.setConnectTimeout(10000); otaHttp.setTimeout(10000);
    otaHttp.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    if (!otaHttp.begin(otaTls,otaUrl) || otaHttp.GET()!=HTTP_CODE_OK || otaHttp.getSize()!=int(otaSize)) {
      otaFail("Firmware download failed or Content-Length differs from the signed size."); return;
    }
    if (esp_ota_begin(otaPartition,otaSize,&otaHandle)!=ESP_OK) { otaFail("Could not open inactive application slot."); return; }
    mbedtls_sha256_init(&otaDigest); otaDigestStarted=true;
    if (mbedtls_sha256_starts(&otaDigest,0)!=0) { otaFail("Could not initialise image checksum."); return; }
    otaWritten=0; otaQueued=false; otaStartedMs=now; otaLastByteMs=now;
  }
  if (!otaHandle) return;
  if (now-otaLastByteMs>30000UL || now-otaStartedMs>1800000UL) { otaFail("Firmware transfer timed out; current firmware retained."); return; }
  auto stream=otaHttp.getStreamPtr();
  int available=stream->available();
  if (available>0) {
    uint8_t buffer[2048];
    size_t count=stream->readBytes(buffer,std::min(size_t(available),std::min(sizeof(buffer),size_t(otaSize-otaWritten))));
    if (count && (esp_ota_write(otaHandle,buffer,count)!=ESP_OK || mbedtls_sha256_update(&otaDigest,buffer,count)!=0)) { otaFail("Image write/checksum failed."); return; }
    otaWritten+=count; otaLastByteMs=now;
  } else if (!otaHttp.connected() && otaWritten<otaSize) { otaFail("Firmware transfer ended early."); return; }
  if (otaWritten!=otaSize) return;
  uint8_t actual[32], expected[32];
  if (mbedtls_sha256_finish(&otaDigest,actual)!=0 || !otaHex(otaHash,expected,32) || memcmp(actual,expected,32)!=0) { otaFail("Firmware SHA-256 mismatch; boot partition unchanged."); return; }
  mbedtls_sha256_free(&otaDigest); otaDigestStarted=false;
  esp_err_t validated=esp_ota_end(otaHandle); otaHandle=0; otaHttp.end();
  if (validated!=ESP_OK) { otaFail("ESP32 rejected the firmware image."); return; }
  otaStatus="awaiting_health"; otaDetail="Image verified; rebooting into trial application.";
  if (!otaSaveStatus()) { otaFail("Could not persist update state; boot partition unchanged."); return; }
  if (esp_ota_set_boot_partition(otaPartition)!=ESP_OK) { otaFail("Could not select trial app partition."); return; }
  ESP.restart();
}
