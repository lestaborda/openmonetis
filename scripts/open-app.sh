#!/usr/bin/env bash
# Abre o OpenMonetis como app (Brave em modo --app).
# Se o servidor local não estiver no ar, sobe o banco e o Next.js.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${OPENMONETIS_URL:-http://localhost:3000}"
BROWSER="${OPENMONETIS_BROWSER:-brave-browser}"
# Deve bater com StartupWMClass do .desktop (GNOME agrupa o ícone por isso).
APP_CLASS="${OPENMONETIS_WM_CLASS:-openmonetis}"
# Perfil isolado do Brave: evita misturar com o navegador normal.
PROFILE_DIR="${OPENMONETIS_PROFILE_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/openmonetis-brave}"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/openmonetis"
LOG_FILE="$LOG_DIR/dev.log"

is_up() {
	curl -fsS --max-time 1 "$URL" >/dev/null 2>&1
}

start_server() {
	mkdir -p "$LOG_DIR"
	cd "$ROOT"

	if command -v pnpm >/dev/null 2>&1; then
		# Sobe só o Postgres se o compose estiver disponível (ignora falha se já estiver up).
		pnpm run docker:db >>"$LOG_FILE" 2>&1 || true
		nohup pnpm run dev >>"$LOG_FILE" 2>&1 &
	else
		notify-send "OpenMonetis" "pnpm não encontrado. Inicie o servidor manualmente." 2>/dev/null || true
		return 1
	fi

	# Espera o Next.js responder (até ~60s).
	for _ in $(seq 1 60); do
		if is_up; then
			return 0
		fi
		sleep 1
	done

	notify-send "OpenMonetis" "Servidor não respondeu a tempo. Veja $LOG_FILE" 2>/dev/null || true
	return 1
}

if ! is_up; then
	notify-send "OpenMonetis" "Iniciando servidor local…" 2>/dev/null || true
	start_server || exit 1
fi

mkdir -p "$PROFILE_DIR"

# CHROME_DESKTOP: associa a janela ao .desktop no GNOME.
# ozone x11: no Wayland o Brave ignora --class e vira "brave-browser" na dock;
# com X11, WM_CLASS=openmonetis e o ícone favorito fica ativo.
export CHROME_DESKTOP=openmonetis.desktop

exec "$BROWSER" \
	--user-data-dir="$PROFILE_DIR" \
	--ozone-platform=x11 \
	--class="$APP_CLASS" \
	--name="$APP_CLASS" \
	--app="$URL"
