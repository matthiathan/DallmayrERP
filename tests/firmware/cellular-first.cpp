#include "../../firmware/shared/CellularFirst.h"
#include <cassert>
#include <cstdint>
int main() {
  CellularFirst policy;
  assert(policy.preferCellular(0));
  policy.result(100, 503);
  assert(!policy.preferCellular(101));
  assert(!policy.preferCellular(60099));
  assert(policy.preferCellular(60100));
  policy.result(60100, 200);
  assert(!policy.preferCellular(60101));
  assert(policy.preferCellular(120100));
  policy.result(120100, 200);
  assert(policy.preferCellular(120101));
  policy.result(UINT32_MAX-1000, -1);
  assert(!policy.preferCellular(1000));
  assert(policy.preferCellular(60000));
}
