import { type AppVersion, parseAppVersion } from "@/core/updates/appVersion";

/** Written into the build by Vite, from package.json (`vite.config.ts`). */
declare const __APP_VERSION__: string;

/**
 * The app's name and version, as the landing screen signs off with them:
 * "ByteRipper 0.8.5". The number is the upstream release this edition was last
 * brought level with, and it has one home — package.json, which the release
 * skill writes (Skills/release). A build that is not a release — the dev
 * server, the Pages preview of `main` — adds "-dev" (`vite.config.ts`).
 *
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.appNameAndVersion
 * @upstream-differs read from the build rather than from a bundle's Info.plist
 */
export const appNameAndVersion = (): string => `ByteRipper ${__APP_VERSION__}`;

/** The version alone, as a server says it of itself. */
export const appVersionText = (): string => __APP_VERSION__;

/**
 * The version this build is, for comparison — `undefined` for a build made
 * without one, which is what keeps a caller from comparing a release against
 * nothing and calling the result an update.
 *
 * @upstream ByteRipperApp/Updates/AppVersion.swift#AppVersion.current
 * @upstream-differs read from the build rather than from a bundle's Info.plist
 */
export const runningVersion = (): AppVersion | undefined => parseAppVersion(__APP_VERSION__);
