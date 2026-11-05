#!/usr/bin/env bash
#
# Gets sound out of the TV over DisplayPort → HDMI.
#
#     bash /opt/wall-dashboard/deploy/audio-hdmi.sh
#
# Run it as the desktop user, from a terminal **inside the XFCE session**, not
# as root and not through `su`. Two reasons: the sound server is per-session,
# so root's audio is not the audio the browser uses; and `systemctl --user`
# needs a real logind session, which `su` does not create.
#
# No drivers are involved. HDMI/DP audio on the J5005 is snd_hda_codec_hdmi,
# in the stock Debian kernel, and a passive DP→HDMI adapter carries audio
# because DP++ is HDMI signalling. What goes wrong is always further up.
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
    printf 'one the browser uses.\n' >&2
    exit 1
fi

printf '%sHDMI audio setup for %s%s\n' "$BOLD" "$(id -un)" "$OFF"

# ------------------------------------------------------- 0. session sanity

say "Session"
if ! systemctl --user show-environment >/dev/null 2>&1; then
    bad "no systemd user session"
    echo "        Audio is managed by per-user services, so this has to run from"
    echo "        a terminal inside the logged-in desktop. A shell reached with"
    echo "        'su' or 'sudo su' does not get one."
    exit 1
fi
ok "systemd user session present (XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-unset})"

# ------------------------------------------------------------ 1. the server

say "Sound server"
if ! command -v pactl >/dev/null 2>&1 || ! pactl info >/dev/null 2>&1; then
    bad "no sound server answering"
    # provision.sh used to install none at all. The xfce4 metapackage Depends
    # on xfce4-pulseaudio-plugin, which is a panel applet needing only
    # libpulse0 — so dpkg shows something pulse-shaped while nothing serves
    # audio, which is very easy to misread as "PulseAudio is installed".
    echo "        installing the PipeWire stack (Trixie's default)"
    sudo apt-get update -qq
    sudo apt-get install -y pipewire-audio pavucontrol alsa-utils \
        || { bad "install failed"; exit 1; }
else
    ok "$(pactl info 2>/dev/null | sed -n 's/^Server Name: //p')"
fi

# ------------------------------------------------- 2. devices, or the lack

say "Devices"
CARDS="$(pactl list short cards 2>/dev/null)"

if [ -z "$CARDS" ]; then
    bad "the server is answering but reports no cards"
    # This is the giveaway. WirePlumber is the session manager that turns ALSA
    # devices into PipeWire nodes; pipewire-pulse answers pactl perfectly while
    # wireplumber is dead, and the symptom is exactly this — a working server
    # with nothing in it. The hardware is never the problem when aplay -l is
    # happy.
    echo "        ALSA sees the hardware, so this is the session manager, not the card:"
    aplay -l 2>/dev/null | grep '^card' | sed 's/^/          /'

    echo
    for unit in pipewire pipewire-pulse wireplumber; do
        printf '        %-16s %s\n' "$unit" \
            "$(systemctl --user is-active "$unit" 2>/dev/null || echo 'not running')"
    done

    say "Starting the user audio services"
    systemctl --user enable --now pipewire.socket pipewire-pulse.socket 2>&1 \
        | sed 's/^/        /'
    systemctl --user enable --now pipewire pipewire-pulse wireplumber 2>&1 \
        | sed 's/^/        /'
    sleep 3

    CARDS="$(pactl list short cards 2>/dev/null)"
    if [ -z "$CARDS" ]; then
        bad "still no cards"
        systemctl --user status wireplumber --no-pager -n 15 2>&1 | sed 's/^/        /'
        echo
        echo "        If wireplumber is missing entirely:  sudo apt-get install -y wireplumber"
        echo "        If it is crashing, log out and back in — a stale session can"
        echo "        leave it unable to claim the devices."
        exit 1
    fi
    fixed "cards appeared after starting the session manager"
fi

printf '%s\n' "$CARDS" | sed 's/^/        /'

# Take the first card by position rather than by name. Matching on 'alsa_card'
# is a guess about naming that costs a confusing failure when it is wrong, and
# this machine has exactly one audio device.
CARD="$(printf '%s\n' "$CARDS" | awk 'NR==1 {print $2}')"
ok "using card $CARD"

# ----------------------------------------------------- 3. pick the live port

say "Output profiles"
# Three DisplayPorts means three HDMI profiles and only one with a screen on
# it. `available: yes` is the card reporting which — far better than guessing
# by name, which picks a dead port two times in three.
pactl list cards | tr -d '\t' | grep -E '^output:(hdmi|analog)' | sed 's/^/        /'

LIVE="$(pactl list cards | tr -d '\t' | grep -E '^output:hdmi' \
    | grep 'available: yes' | head -1 | cut -d: -f1-2)"

if [ -z "$LIVE" ]; then
    warn "no HDMI profile reports an attached display"
    echo "        aplay -l named one of them after the TV, so the link is good —"
    echo "        make sure the TV is on and showing this input, then re-run."
else
    CURRENT="$(pactl list cards | sed -n 's/^[[:space:]]*Active Profile: //p' | head -1)"
    if [ "$CURRENT" = "$LIVE" ]; then
        ok "already on $LIVE"
    else
        pactl set-card-profile "$CARD" "$LIVE" \
            && fixed "profile was '$CURRENT', now '$LIVE'" \
            || bad "could not set profile $LIVE"
        sleep 1
    fi
fi

# --------------------------------------------------------- 4. default sink

say "Default sink"
SINK="$(pactl list short sinks 2>/dev/null | awk '/hdmi/ {print $2; exit}')"
[ -z "$SINK" ] && SINK="$(pactl get-default-sink 2>/dev/null)"

if [ -z "$SINK" ] || [ "$SINK" = "@DEFAULT_SINK@" ]; then
    bad "no sink to select"
else
    pactl set-default-sink "$SINK" && ok "default sink: $SINK"
    # Chromium follows the default sink, but a muted or zeroed sink is
    # indistinguishable from a broken one from across the room.
    pactl set-sink-mute "$SINK" 0 2>/dev/null && ok "unmuted"
    pactl set-sink-volume "$SINK" 60% 2>/dev/null && ok "volume 60%"
fi

printf '\n'
pactl list short sinks 2>/dev/null | sed 's/^/        /'

# ------------------------------------------------------------- 5. test tone

say "Test tone"
if command -v speaker-test >/dev/null 2>&1; then
    echo "        two seconds of 440Hz — turn the TV up if you hear nothing"
    speaker-test -D pulse -c 2 -t sine -f 440 -l 1 >/dev/null 2>&1 &
    TESTPID=$!
    sleep 2
    kill "$TESTPID" 2>/dev/null
    wait "$TESTPID" 2>/dev/null
    ok "tone sent to ${SINK:-the default sink}"
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
