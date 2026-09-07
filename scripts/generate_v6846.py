from pathlib import Path

src = Path('firmware/DallmayrTelemetryV6_8_45/DallmayrTelemetryV6_8_45.ino')
dst = Path('firmware/DallmayrTelemetryV6_8_46/DallmayrTelemetryV6_8_46.ino')
text = src.read_text(encoding='utf-8')

text = text.replace('V6.8.45', 'V6.8.46')
text = text.replace('6.8.45-esp32s3-air780eu-durable-counters', '6.8.46-esp32s3-air780eu-mdb-fault-recovery')

old = '''  } else if (graceExpired) {
    LocalFault* existing = findFault("MDB_NO_VALID_TRAFFIC");
    if (existing && existing->active) {
      setLocalFaultState("MDB_NO_VALID_TRAFFIC", false, "info", "mdb",
                         "Checksum-valid MDB Master traffic restored", "");
    }
  }
}'''
new = '''  } else if (graceExpired) {
    // Reconcile recovery even after reboot. Supabase can still hold an open
    // MDB_NO_VALID_TRAFFIC fault from the previous boot while the ESP32's
    // RAM-only LocalFault table starts empty. Calling setLocalFaultState(false)
    // unconditionally here creates one local inactive state and emits one clear
    // transition after boot; subsequent healthy loops are deduplicated locally.
    setLocalFaultState("MDB_NO_VALID_TRAFFIC", false, "info", "mdb",
                       "Checksum-valid MDB Master traffic restored", "");
  }
}'''
if old not in text:
    raise RuntimeError('MDB recovery block changed unexpectedly')
text = text.replace(old, new, 1)

dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(text, encoding='utf-8')
