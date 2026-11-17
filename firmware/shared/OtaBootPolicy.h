#pragma once
#include <cstring>
// Recover the public update status after a reset. Download interruption is not
// a rolled-back trial; retaining a confirmed image must survive a lost final ACK.
inline const char* otaRecoveredStatus(const char* saved, bool pendingVerify, bool confirmedTarget) {
  if (pendingVerify) return "awaiting_health";
  if (std::strcmp(saved,"installing")==0) return "failed";
  if (std::strcmp(saved,"awaiting_health")==0) return confirmedTarget ? "healthy" : "rolled_back";
  return saved;
}
