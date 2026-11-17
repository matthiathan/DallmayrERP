#include "../../firmware/shared/OtaBootPolicy.h"
#include <cassert>
#include <cstring>
int main() {
 assert(std::strcmp(otaRecoveredStatus("installing",false,false),"failed")==0);
 assert(std::strcmp(otaRecoveredStatus("awaiting_health",false,false),"rolled_back")==0);
 assert(std::strcmp(otaRecoveredStatus("awaiting_health",false,true),"healthy")==0);
 assert(std::strcmp(otaRecoveredStatus("installing",true,false),"awaiting_health")==0);
}
