if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/generated/telemetry.cpp")
  message(FATAL_ERROR "Run scripts/prepare-telemetry-idf.mjs with the Arduino build directory first")
endif()
idf_component_register(SRCS "generated/telemetry.cpp"
  INCLUDE_DIRS "generated"
  REQUIRES arduino-esp32 arduinojson)
