declare const __APP_EDITION__: string;
declare const __APP_NAME__: string;

/** 'alpha' | 'stable' | 'seven' */
export const APP_EDITION: string = __APP_EDITION__;
/** 'TCAlpha' | 'TOKENICODE' | 'tokenicode-7' */
export const APP_NAME: string = __APP_NAME__;
export const IS_ALPHA = APP_EDITION === 'alpha';
/** Personal frozen edition — never polls stock update endpoints. */
export const IS_SEVEN = APP_EDITION === 'seven';
