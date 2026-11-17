#pragma once
#include <stdint.h>
// After a failed backend request, use Wi-Fi between cellular probes. Require
// two successful probes a minute apart before resuming uninterrupted cellular.
class CellularFirst {
  bool primary_ = true;
  uint8_t successes_ = 0;
  uint32_t lastProbe_ = 0;
public:
  bool preferCellular(uint32_t now) const {
    return primary_ || uint32_t(now - lastProbe_) >= 60000U;
  }
  void result(uint32_t now, int status) {
    if (status >= 200 && status < 300) {
      if (!primary_ && ++successes_ >= 2) primary_ = true;
    } else {
      primary_ = false;
      successes_ = 0;
    }
    lastProbe_ = now;
  }
};
