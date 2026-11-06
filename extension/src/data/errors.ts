export type DataErrorCode='NETWORK_ERROR'|'INVALID_DATA'|'PAYLOAD_TOO_LARGE'|'EXPANSION_LIMIT'|
    'UNSUPPORTED_CALENDAR'|'UNKNOWN_TIME_ZONE'|'KEYRING_LOCKED'|'SECRET_DELETION_FAILED'|
    'AUTH_ERROR'|'RATE_LIMITED'|'NO_PLAYER'|'NO_INTERFACE'|'SERVICE_UNAVAILABLE'|'INTERNAL_ERROR';
export class DataFailure extends Error {
    constructor(readonly code:DataErrorCode){super(code);this.name='DataFailure';}
}
export class DataCancelled extends Error {constructor(){super('CANCELLED');}}
