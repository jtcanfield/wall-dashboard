#!/usr/bin/env bash
#
# Gets sound out of the TV over DisplayPort → HDMI.
#
#     bash /opt/wall-dashboard/deploy/audio-hdmi.sh
#
# Run it as the desktop user, **not** as root or under sudo su. The sound
# server is per-session: as root you would be talking to a different user's
# audio, or to nothing at all, and whatever you fixed would not be the thing
# the browser is using.
#
# No drivers are involved. HDMI/DP audio on the J5005 is snd_hda_codec_hdmi,
# which is in the stock Debian kernel. What goes wrong is further up: either
# no sound server is installed, or the card is sitting on a profile for a port
# with nothing plugged into it.
set -uo pipefail

CYAN=$'\033[1;36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'
BOLD=$'\033[1m'; OFF=$'\033[0m'
say()   { printf '\n%s==> %s%s\n' "$CYAN" "$1" "$OFF"; }
ok()    { printf '  %sok%s    %s\n' "$GREEN" "$OFF" "$1"; }
fixed() { printf '  %sfixed%s %s\n' "$YELLOW" "$OFF" "$1"; }
warn()  { printf '  %swarn%s  %s\n' "$YELLOW" "$OFF" "$1"; }
bad()   { printf '  %sFAIL%s  %s\n' "$RED" "$OFF" "$1"; }

if [ "$(id -u)" -eq 0 ]; then
    printf '%sRun this as the desktop user, not root.%s\n' "$RED" "$OFF" >&2
    printf 'The sound server is per-session; as root you are not talking to the\n' >&2
    printf 'one the browser uses. Try:  su - kiosk -c "bash %s"\n' "$0" >&2
    exit 1
fi

printf '%sHDMI audio setup for %s%s\n' "$BOLD" "$(id -un)" "$OFF"

# ------------------------------------------------------------ 1. the server

say "Sound server"
if ! command -v pactl >/dev/null 2>&1 || ! pactl info >/dev/null 2>&1; then
    bad "no sound server answering"
    # provision.sh installed xfce4, whose Depends include the *panel plugin*
    # xfce4-pulseaudio-plugin — which needs only libpulse0, not a daemon. It is
    # very easy to see that in dpkg output and conclude PulseAudio is present
    # when nothing is actually serving audio.
    echo "        installing the PipeWire stack (Trixie's default)"
    sudo apt-get update -qq
    # pipewire-audio pulls wireplumber, pipewire-pulse and pipewire-alsa, and
    # removes pulseaudio so the two cannot fight over the device.
    sudo apt-get install -y pipewire-audio pavucontrol alsa-utils || {
        bad "install failed"; exit 1; }
    systemctl --user daemon-reload 2>/dev/null
    systemctl --user restart pipewire pipewire-pulse wireplumber 2>/dev/null
    sleep 2
    pactl info >/dev/null 2>&1 && fixed "sound server running" || {
        bad "still nothing — log out and back in, then re-run this"; exit 1; }
else
    ok "$(pactl info | sed -n 's/^Server Name: //p')"
fi

# ----------------------------------------------------- 2. pick the live port

say "Output ports"
# The Wyse has three DisplayPorts, so the card carries three HDMI profiles and
# only one of them has a screen on it. `available: yes` is the card reporting
# which — that is the whole selection criterion, and it beats guessing by name.
CARD="$(pactl list short cards | awk '/alsa_card/ {print $2; exit}')"
if [ -z "$CARD" ]; then
    bad "no ALSA card found — check: aplay -l"
    exit 1
fi
ok "card $CARD"

pactl list cards | tr -d '\t' | grep -E '^output:(hdmi|analog)' \
    | sed 's/^/        /'

LIVE="$(pactl list cards | tr -d '\t' \
    | grep -E '^output:hdmi' | grep 'available: yes' \
    | head -1 | cut -d: -f1-2)"

if [ -z "$LIVE" ]; then
    warn "no HDMI profile reports an attached display"
    echo "        The passive DP->HDMI adapter carries audio (DP++ is HDMI"
    echo "        signalling), so this usually means the TV was off or on another"
    echo "        input when the card was probed. Turn it on, select this input,"
    echo "        then re-run."
else
    CURRENT="$(pactl list cards | sed -n "/Name: $CARD/,\$p" \
        | sed -n 's/^[[:space:]]*Active Profile: //p' | head -1)"
    if [ "$CURRENT" = "$LIVE" ]; then
        ok "already on $LIVE"
    else
        pactl set-card-profile "$CARD" "$LIVE" \
            && fixed "profile was '$CURRENT', now '$LIVE'" \
            || bad "could not set profile $LIVE"
    fi
fi

# -------------------------------------------------------- 3. default sink

say "Default sink"
SINK="$(pactl list short sinks | awk '/hdmi/ {print $2; exit}')"
[ -z "$SINK" ] && SINK="$(pactl get-default-sink 2>/dev/null)"

if [ -z "$SINK" ]; then
    bad "no sink to select"
else
    pactl set-default-sink "$SINK" && ok "default sink: $SINK"
    # Chromium follows the default sink, but a muted or zeroed sink looks
    # exactly like a broken one from the sofa.
    pactl set-sink-mute "$SINK" 0 2>/dev/null && ok "unmuted"
    pactl set-sink-volume "$SINK" 60% 2>/dev/null && ok "volume 60%"
fi

printf '\n'
pactl list short sinks | sed 's/^/        /'

# ------------------------------------------------------------- 4. test tone

say "Test tone"
if command -v speaker-test >/dev/null 2>&1; then
    echo "        two seconds of 440Hz — turn the TV up if you hear nothing"
    speaker-test -D pulse -c 2 -t sine -f 440 -l 1 >/dev/null 2>&1 &
    TESTPID=$!
    sleep 2
    kill "$TESTPID" 2>/dev/null
    wait "$TESTPID" 2>/dev/null
    ok "tone sent to $SINK"
else
    warn "speaker-test not installed (alsa-utils)"
fi

cat <<EOF

${BOLD}If the tone played but Twitch is still silent${OFF}, the browser on screen was
probably started by the 05:55 cron entry rather than by the desktop session. A
cron job has no XDG_RUNTIME_DIR, so Chromium cannot reach the sound server at
all — video is perfect and there is no audio. Restart it from the session:

    pkill -f -- --class=WallDashboard

kiosk.sh relaunches it a few seconds later with the session's environment.

${BOLD}Mixer GUI:${OFF} pavucontrol — the Playback tab shows Chromium's stream and
which sink it landed on.
EOF
