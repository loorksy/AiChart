import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Design tokens mirrored from the platform's `src/app/globals.css`.
/// Monochrome base + gold accent, 10px radius, Cairo type.
class LonoraTokens {
  // Light
  static const lightBackground = Color(0xFFFFFFFF);
  static const lightForeground = Color(0xFF000000);
  static const lightCard = Color(0xFFFFFFFF);
  static const lightPrimary = Color(0xFF000000);
  static const lightPrimaryFg = Color(0xFFFFFFFF);
  static const lightMuted = Color(0xFFF2F2F2);
  static const lightMutedFg = Color(0xFF404040);
  static const lightGold = Color(0xFFD97706);
  static const lightDestructive = Color(0xFFDC2626);
  static const lightBorder = Color(0xFFE5E5E5);

  // Dark
  static const darkBackground = Color(0xFF000000);
  static const darkForeground = Color(0xFFF5F5F5);
  static const darkCard = Color(0xFF0A0A0A);
  static const darkPrimary = Color(0xFFFAFAFA);
  static const darkPrimaryFg = Color(0xFF000000);
  static const darkMuted = Color(0xFF111111);
  static const darkMutedFg = Color(0xFFA3A3A3);
  static const darkGold = Color(0xFFF59E0B);
  static const darkDestructive = Color(0xFFEF4444);
  static const darkBorder = Color(0xFF1F1F1F);

  static const radius = 10.0;
  static const radiusLg = 14.0;
}

ThemeData lonoraTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;

  final background =
      dark ? LonoraTokens.darkBackground : LonoraTokens.lightBackground;
  final foreground =
      dark ? LonoraTokens.darkForeground : LonoraTokens.lightForeground;
  final card = dark ? LonoraTokens.darkCard : LonoraTokens.lightCard;
  final primary = dark ? LonoraTokens.darkPrimary : LonoraTokens.lightPrimary;
  final primaryFg =
      dark ? LonoraTokens.darkPrimaryFg : LonoraTokens.lightPrimaryFg;
  final muted = dark ? LonoraTokens.darkMuted : LonoraTokens.lightMuted;
  final mutedFg = dark ? LonoraTokens.darkMutedFg : LonoraTokens.lightMutedFg;
  final gold = dark ? LonoraTokens.darkGold : LonoraTokens.lightGold;
  final destructive =
      dark ? LonoraTokens.darkDestructive : LonoraTokens.lightDestructive;
  final border = dark ? LonoraTokens.darkBorder : LonoraTokens.lightBorder;

  final scheme = ColorScheme(
    brightness: brightness,
    primary: primary,
    onPrimary: primaryFg,
    secondary: gold,
    onSecondary: dark ? Colors.black : Colors.white,
    error: destructive,
    onError: Colors.white,
    surface: card,
    onSurface: foreground,
    surfaceContainerHighest: muted,
    onSurfaceVariant: mutedFg,
    outline: border,
    outlineVariant: border,
  );

  final textTheme = GoogleFonts.cairoTextTheme(
    ThemeData(brightness: brightness).textTheme,
  ).apply(bodyColor: foreground, displayColor: foreground);

  OutlineInputBorder inputBorder(Color color) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(LonoraTokens.radius),
        borderSide: BorderSide(color: color),
      );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: background,
    textTheme: textTheme,
    dividerColor: border,
    appBarTheme: AppBarTheme(
      backgroundColor: background,
      foregroundColor: foreground,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
      ),
    ),
    cardTheme: CardThemeData(
      color: card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(LonoraTokens.radiusLg),
        side: BorderSide(color: border),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: background,
      border: inputBorder(border),
      enabledBorder: inputBorder(border),
      focusedBorder: inputBorder(primary),
      errorBorder: inputBorder(destructive),
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      hintStyle: TextStyle(color: mutedFg),
      labelStyle: TextStyle(color: mutedFg),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: primaryFg,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(LonoraTokens.radius),
        ),
        textStyle: textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600),
        minimumSize: const Size(44, 44),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: foreground,
        side: BorderSide(color: border),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(LonoraTokens.radius),
        ),
        minimumSize: const Size(44, 44),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: foreground),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: muted,
      labelStyle: TextStyle(color: mutedFg, fontSize: 12),
      side: BorderSide(color: border),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(999),
      ),
    ),
    listTileTheme: ListTileThemeData(
      iconColor: mutedFg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(LonoraTokens.radius),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: dark ? LonoraTokens.darkMuted : LonoraTokens.lightPrimary,
      contentTextStyle: TextStyle(
        color: dark ? LonoraTokens.darkForeground : LonoraTokens.lightPrimaryFg,
        fontFamily: GoogleFonts.cairo().fontFamily,
      ),
      behavior: SnackBarBehavior.floating,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: card,
      indicatorColor: muted,
      iconTheme: WidgetStatePropertyAll(IconThemeData(color: foreground)),
      labelTextStyle: WidgetStatePropertyAll(
        textTheme.labelSmall!.copyWith(fontWeight: FontWeight.w600),
      ),
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: card,
      indicatorColor: muted,
      selectedIconTheme: IconThemeData(color: foreground),
      unselectedIconTheme: IconThemeData(color: mutedFg),
      selectedLabelTextStyle:
          textTheme.labelMedium!.copyWith(fontWeight: FontWeight.w700),
      unselectedLabelTextStyle: textTheme.labelMedium!.copyWith(color: mutedFg),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: gold),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? primaryFg : mutedFg,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? primary : muted,
      ),
    ),
  );
}
