#include "clock.h"

unsigned long ticks;

/* Count one second. */
void clock_tick(void) {
  ticks += TICK_STEP;
  if (ticks % 60 == 0) clock_minute(ticks / 60);
}
