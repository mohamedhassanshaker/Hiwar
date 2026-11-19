#!/usr/bin/env bash
# A `kubectl port-forward` that survives being dropped.
#
# A single forward does not last a full browser suite on Windows: it closes under the
# connection pattern the tests produce, and every later query fails with ECONNREFUSED on a
# run that was otherwise green. Restarting it is not a retry of the work — the forward is
# plumbing, and the suite behind it has no reason to care that one died.
#
# Sourced, not executed, so the caller gets `forward_start` and `forward_stop` and keeps
# the trap in its own shell.

# Supervise one forward until `forward_stop`. A caller that needs more than one target
# calls this more than once: every PID and marker accumulates, so one `forward_stop` tears
# all of them down.
#
#   forward_start <namespace> <target> <local-port> <remote-port>
FORWARD_PIDS=()
FORWARD_MARKERS=()
forward_start() {
  local namespace="$1" target="$2" local_port="$3" remote_port="$4"
  local marker
  marker="$(mktemp -t hiwar-forward-XXXXXX)"
  FORWARD_MARKERS+=("${marker}")

  (
    while [ -e "${marker}" ]; do
      kubectl -n "${namespace}" port-forward "${target}" "${local_port}:${remote_port}" >/dev/null 2>&1 || true
      # A clean exit and a crash look the same from here, and both mean the port is gone.
      # The pause keeps a target that is genuinely down from becoming a spin.
      [ -e "${marker}" ] && sleep 1
    done
  ) &
  FORWARD_PIDS+=("$!")

  # The caller's first query must not race the listener coming up.
  local waited=0
  until forward_ready "${local_port}"; do
    waited=$((waited + 1))
    if [ "${waited}" -gt 60 ]; then
      echo "port-forward to ${target} never became reachable on ${local_port}." >&2
      return 1
    fi
    sleep 0.5
  done
}

# Whether something is listening on the local port yet.
forward_ready() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "${port}" >/dev/null 2>&1
  else
    # Bash's own /dev/tcp, which Git Bash on Windows has when `nc` is absent.
    (exec 3<>"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1 && exec 3>&-
  fi
}

# Stop supervising and take every forward started in this shell with it.
forward_stop() {
  local marker pid
  for marker in "${FORWARD_MARKERS[@]+"${FORWARD_MARKERS[@]}"}"; do
    rm -f "${marker}"
  done
  for pid in "${FORWARD_PIDS[@]+"${FORWARD_PIDS[@]}"}"; do
    kill "${pid}" >/dev/null 2>&1 || true
    # The supervisor's own child outlives it otherwise, holding the port for the next run.
    pkill -P "${pid}" >/dev/null 2>&1 || true
  done
}
