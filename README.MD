# API
## Environment variables
- `INTERVAL_SEC` - frequency the fan PWM is updated. Default: 1 sec.
- `NODE_PORT` - default API port. Default: 80.
- `EXPIRY_SEC` - how long API should consider a node since last update
- `LOW_TEMP_C` - lowest temp in C when fan turns on. Default: 60
- `HIGH_TEMP_C` - temp in C when fan goes 100%. Default: 78
- `DEFAULT_TEMP_C` - default temp in C when no node reported their temp. Default: same as `HIGH_TEMP_C`