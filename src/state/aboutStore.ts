import { createStore } from "@/state/store";

/**
 * Whether the About panel is showing. Nothing else about it is state: the name,
 * the version and the credits are what the build is.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showAbout
 * @upstream-differs a dialog in the page; upstream asks the system for its standard panel
 */
export const aboutStore = createStore<{ readonly open: boolean }>({ open: false });

export const showAbout = (): void => aboutStore.update(() => ({ open: true }));
export const hideAbout = (): void => aboutStore.update(() => ({ open: false }));
