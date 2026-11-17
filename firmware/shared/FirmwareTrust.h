#pragma once
// Provision public trust anchors before enabling remote updates. Never put the
// signing private key on the device or in this repository. Empty = OTA disabled.
static const char DALLMAYR_OTA_PUBLIC_KEY_PEM[] = "";
static const char DALLMAYR_OTA_CA_PEM[] = "";
