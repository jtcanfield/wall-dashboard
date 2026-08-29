#!/bin/sh
#
# The X session for the wall display. Launched by wall-kiosk.service through
# startx, so this script *is* the session: when it exits, X exits.
set -eu

DASHBOARD_URL="http://localhost:3000"

# Never blank, never sleep. Power is the TV's job, over the LAN via Roku ECP —
# see deploy/tv-power.crontab. DPMS is left enabled but with every timeout at
# zero, which means "on, and never triggers on its own".
xset s off
xset s noblank
xset +dpms
xset dpms 0 0 0

# No pointer on an unattended display. -idle 0 hides it immediately rather than
# after a delay, so it never appears at all.
unclutter -idle 0 &

# A window manager is not strictly required, but Chromium's --kiosk relies on
# one to go genuinely fullscreen rather than merely borderless, and openbox is
# about as small as they come.
openbox --sm-disable &

# Chromium paints an error page if it beats the server to the port, and on a
# kiosk there is nobody to press reload. Waiting costs a second at boot and
# removes a failure that would otherwise need a physical keyboard to clear.
until curl -sf -o /dev/null "$DASHBOARD_URL/api/health"; do
    sleep 1
done

# --autoplay-policy is not optional once the Twitch player is on screen:
# Chromium blocks autoplay without a user gesture even when the video is muted,
# and on a kiosk there is never going to be a gesture. The failure is silent —
# a black player box and nothing in the console.
#
# --incognito keeps a crash from producing a "restore pages?" bubble across the
# whole display, which is the sort of thing nobody notices for a week.
exec chromium \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --incognito \
    --autoplay-policy=no-user-gesture-required \
    --disable-session-crashed-bubble \
    --disable-features=TranslateUI \
    --check-for-update-interval=31536000 \
    "$DASHBOARD_URL"
