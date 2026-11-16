#include "../config.h"
#include "thermostat.h"

#define TARGET_TENTHS 200

/**
 * Read the sensor, in tenths of a °C.
 */
int Thermostat::read() {
  return sensor.sample(SENSOR_PIN) + offset;
}

// Switch the heater.
// Returns true when it changed.
bool Thermostat::update(int now) {
  const int reading = read();
  bool on = reading < TARGET_TENTHS - HYSTERESIS;
  #if ENABLED(HAS_FAN)
    set_fan(on ? FAN_LOW : FAN_OFF);
  #endif
  last = now;
  return apply(on);
}

#ifdef HAS_BUZZER
static void alarm(int level) { beep(level, TONE_HZ); }
#else
static void alarm(int level) { (void)level; }
#endif
