# HL7 v2 architecture (future)

This document describes a later interface for HL7 v2. No listener is running. Do not expose a public MLLP port.

## Messages in scope later

| Message | Use |
| --- | --- |
| ADT | Patient registration and updates into the local patient record |
| ORU | Result availability as document metadata, not as an interpretation |
| SIU | Scheduling context for the requested service date |
| ACK | Application accept or error after a message is stored |

ORM/ORU content that looks like an authorization decision still requires a staff status change. An HL7 message must not move a case to approved or denied by itself.

## Transport

MLLP should terminate on a private network or VPN, not on the public internet. A small interface process would:

1. Accept MLLP from an allowlisted source.
2. Validate the sending facility against an organization connection.
3. Parse and map into the same service functions the UI uses.
4. Return an ACK only after the tenant-scoped write commits.
5. Write an audit event with message control id and source. Do not store the raw message if it contains PHI until the PHI program exists.

HTTP-based HL7 wrappers, if a partner requires them, need mutual TLS and the same organization binding.

## Mapping

- MSH sending facility maps to one HealthFlow organization. Unknown facilities are rejected.
- PID identifiers map to MRN only within that organization.
- PV1 / ORC attending fields map to providers when an NPI matches; otherwise the message is queued for a person.
- OBX payloads become documents with category `LAB_RESULT` or `IMAGING` after MIME and size checks. They are not displayed as public files.

## Security

- No unauthenticated listener.
- No logging of full PID segments in application logs.
- Replay protection using message control ids per organization.
- Network policy that blocks inbound 2575 from the public internet.

## Explicitly not in this MVP

There is no MLLP socket, no ACK generator, and no claim that any HL7 feed is connected.
