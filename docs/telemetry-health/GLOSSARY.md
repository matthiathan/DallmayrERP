# Glossary

This glossary belongs to an illustrative design exercise, not an approved production change.

## Device connectivity
Whether the service has recently heard from a telemetry device. It does not establish that the attached vending machine is communicating or operating correctly.

## Machine data freshness
An umbrella term for machine communication freshness and sales report freshness. These describe different conditions and are assessed separately.

## Unknown
A status used when available evidence is insufficient to establish a condition. An absence of sales alone does not establish a machine communication fault.

## Heartbeat
A periodic message indicating that a telemetry device is in contact with the service.

## Expected heartbeat interval
The intended time between a device's heartbeats.

## Never seen
A device connectivity status indicating that the service has never heard from the device.

## Machine communication observation
Evidence that valid communication from the attached vending machine was observed. It is distinct from a sale and does not establish that every machine function works.

## Sales report
Sales information for a reporting period. A report with zero sales can still be complete and valid.

## Reporting schedule
The timetable according to which sales reports are expected.

## Grace period
The permitted delay after a report's scheduled delivery time before it becomes overdue.

## Overdue sales report
An expected sales report that has not arrived by its scheduled delivery time plus its grace period. This can occur while the telemetry device is online.


## Machine communication freshness
How recent reliable evidence of communication from the attached machine is, relative to when such evidence is expected.

## Sales report freshness
Whether expected sales reports have arrived according to their reporting schedule.

## Device assignment
The association of a telemetry device with a particular vending machine for a particular period.

## Observation time
When the reported machine communication occurred.

## Receipt time
When the service received information from a telemetry device.

## Dashboard refresh time
When the dashboard last successfully retrieved status information from the service.
