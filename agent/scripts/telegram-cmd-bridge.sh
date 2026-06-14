#!/usr/bin/env bash
# Translates Telegram callback_data or slash/keyboard text into agent context.
# Usage: telegram-cmd-bridge.sh "cmd:approve:12" | telegram-cmd-bridge.sh "/rased"
set -euo pipefail

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  echo "Usage: $0 <callback_data|/command|keyboard label>" >&2
  exit 1
fi

declare -A MAP=(
  ["cmd:home"]="القائمة الرئيسية"
  ["cmd:balance"]="اعرض الرصيد والمحفظة"
  ["cmd:trades"]="اعرض الصفقات المفتوحة"
  ["cmd:settings"]="اعرض الإعدادات والوضع الحالي"
  ["cmd:market:crypto"]="حوّل السوق النشط إلى كربتو"
  ["cmd:market:forex"]="حوّل السوق النشط إلى فوركس"
  ["cmd:env:demo"]="فعّل وضع الديمو"
  ["cmd:env:live"]="فعّل الوضع الحقيقي"
  ["cmd:analyze:pick"]="أريد تحليل زوج — اعرض قائمة الرموز"
  ["/qaima"]="القائمة الرئيسية"
  ["/start"]="القائمة الرئيسية"
  ["/tahil"]="أريد تحليل زوج — اعرض قائمة الرموز"
  ["/rased"]="اعرض الرصيد والمحفظة"
  ["/safaqat"]="اعرض الصفقات المفتوحة"
  ["/iadadat"]="اعرض الإعدادات والوضع الحالي"
  ["/crypto"]="حوّل السوق النشط إلى كربتو"
  ["/forex"]="حوّل السوق النشط إلى فوركس"
  ["/demo"]="فعّل وضع الديمو"
  ["/live"]="فعّل الوضع الحقيقي"
  ["📊 تحليل زوج"]="أريد تحليل زوج — اعرض قائمة الرموز"
  ["💰 الرصيد"]="اعرض الرصيد والمحفظة"
  ["📈 الصفقات"]="اعرض الصفقات المفتوحة"
  ["⚙️ الإعدادات"]="اعرض الإعدادات والوضع الحالي"
  ["🪙 كربتو"]="حوّل السوق النشط إلى كربتو"
  ["💱 فوركس"]="حوّل السوق النشط إلى فوركس"
  ["🧪 ديمو"]="فعّل وضع الديمو"
  ["🔴 حقيقي"]="فعّل الوضع الحقيقي"
)

if [[ -n "${MAP[$INPUT]:-}" ]]; then
  echo "[CMD:${INPUT}] ${MAP[$INPUT]}"
  exit 0
fi

if [[ "$INPUT" =~ ^cmd:approve:([0-9]+)$ ]]; then
  echo "[CMD:${INPUT}] وافق على الصفقة المعلقة رقم ${BASH_REMATCH[1]} — إن مرّ أكثر من دقيقة أعد تحليل السوق أولاً"
  exit 0
fi
if [[ "$INPUT" =~ ^cmd:reject:([0-9]+)$ ]]; then
  echo "[CMD:${INPUT}] ارفض الصفقة المعلقة رقم ${BASH_REMATCH[1]}"
  exit 0
fi
if [[ "$INPUT" =~ ^cmd:review:([0-9]+)$ ]]; then
  echo "[CMD:${INPUT}] راجع الصفقة المفتوحة رقم ${BASH_REMATCH[1]}"
  exit 0
fi
if [[ "$INPUT" =~ ^cmd:close:([0-9]+)$ ]]; then
  echo "[CMD:${INPUT}] أغلق الصفقة رقم ${BASH_REMATCH[1]} بعد التحليل"
  exit 0
fi

echo "[CMD:${INPUT}]"
