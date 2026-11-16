// Thermostat settings (an invented example).
#define TARGET_TENTHS 215   // 21.5 °C
#define HAS_FAN
//#define HAS_BUZZER
// #define LOG_LEVEL 2 // quiet
#define CLAMP(v, lo, hi) \
  ((v) < (lo) ? (lo) : (v) > (hi) ? (hi) : (v))

#if defined(HAS_FAN) && !ENABLED(ECO_MODE)
  #define FAN_PIN 7
#endif
