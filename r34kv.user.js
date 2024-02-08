// ==UserScript==
// @name         R34 keep volume
// @namespace    http://tampermonkey.net/
// @version      2024-02-08
// @description  Keeps the volume level saved to disk for convenience.
// @author       You
// @match        https://rule34.xyz/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=rule34.xyz
// @grant        none
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';


    const loggerFactory = (tag) => {
        const logMessage = typeof localStorage.DEBUG_MODE === "undefined" ? () => {} : (loggerFunction, ...msg) => loggerFunction(tag, ...msg);
        const loggerInstance = (...msg) => logMessage(console.info, ...msg);
        loggerInstance.w = (...msg) => logMessage(console.warn, ...msg);
        loggerInstance.e = (...msg) => logMessage(console.error, ...msg);
        loggerInstance.d = (...msg) => logMessage(console.debug, ...msg);
        return loggerInstance;
    };

    const log = loggerFactory('R34KV');

    function forElement(selector, rootNode = document) {
        log.d('will wait for element', selector, rootNode);
        return new Promise((resolve, reject) => {
            const element = rootNode.querySelector(selector);

            if (element) {
                log.d('element found immediately');
                resolve(element);
                return;
            }

            const observer = new MutationObserver(mutations => {
                const element = rootNode.querySelector(selector);
                if (element) {
                    log.d('element found after mutation');
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(rootNode, {
                childList: true,
                subtree: true
            });
        });
    }

    const RegExp_escape = ({raw}) => raw;

    function forPath({path, pattern}) {
        log.d('will wait for location', pattern ?? path);
        const isMatch = (urlOrLocation) => {
            const url = new URL(urlOrLocation);
            if (pattern) {
                log.d('pattern', pattern);
                return url.pathname.match(new RegExp(pattern, 'gu')) !== null;
            } else if (path) {
                log.d('path', path);
                return url === path;
            }
        };
        return new Promise((resolve, reject) => {
            if (isMatch(location)) {
                log.d('already on matching location', location.href);
                resolve();
                return;
            }
            // eslint-disable-next-line no-undef
            const nav = navigation
            const listener = (e) => {
                if (e.hashChange || e.downloadRequest !== null) {
                    return;
                }

                log.d('navigating to:', e.destination.url);

                if (isMatch(e.destination.url)) {
                    log.d('navigated to matching location', e.destination.url);
                    resolve();
                    nav.removeEventListener("navigate", listener);
                }
            };
            nav.addEventListener("navigate", listener);
        });
    }

    function forCondition(test, interval = 100) {
        return new Promise((resolve, reject) => {
            function repeat() {
                if (test()) {
                    resolve();
                } else {
                    setTimeout(repeat, interval);
                }
            }
            repeat();
        });
    }


    const runAfterLoad = (fn) => {
        if (document.readyState !== 'loading') {
            log.d('already loaded');
            fn();
        } else {
            log.d('waiting for load');
            document.addEventListener('readystatechange', fn, {once: true});
        }
    }

    function createSynchronizer(config) {
        const configCopy = Object.entries(config);
        return {
            load() {
                const buf = [];
                for (const [prop, truth] of configCopy) {
                    buf.push(JSON.parse(localStorage[prop] ?? truth()));
                }
                return buf;
            },
            save() {
                for (const [prop, truth] of configCopy) {
                    localStorage[prop] = JSON.stringify(truth());
                }
            },
            clear() {
                for (const [prop, truth] of configCopy) {
                    delete localStorage[prop];
                }
            }
        };
    }

    runAfterLoad(async () => {
        log('0. loaded, starting the hook');

        // Loop for re-attaching event listener to video player element when it's replaced or removed
        while (true) {
            log('1. waiting until user is viewing a post');
            await forPath({pattern: RegExp_escape`^/post/\d+`});

            log('2. post detected, waiting for video');
            const video = await forElement("video.video");

            log('3. video element found, loading the config');
            const {load, save, clear} = createSynchronizer({
                __R43KV_muted() {
                    return video.muted;
                },
                __R34KV_volume() {
                    return video.volume;
                }
            });
            let tries = 0;
            // Loop for resetting the config values in local storage when errored
            while (tries < 3) {
                tries++;
                try {
                    const [muted, volume] = load();

                    log('4. loaded config, applying to the media element');
                    video.volume = volume;
                    video.muted = muted;

                    video.addEventListener("volumechange", (_) => {
                        log('5. saving changed volume');
                        save();
                    });

                    break;
                } catch (e) {
                    log.w('something gone wrong. clearing the config and retrying.', e);
                    clear();
                    continue;
                }
            }
            if (tries >= 3) {
                log.e('Could not recover from the error. Halting.');
                break;
            }

            await forCondition(() => !document.body.contains(video));
            log.w("Video element lost, searching again...");
        }
        log.e('The video element will not be manipulated from here on. Try refreshing the page, or contact the developer about this.');
    });
})();
