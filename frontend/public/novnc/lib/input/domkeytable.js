"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _keysym = _interopRequireDefault(require("./keysym.js"));

function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }

/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2018 The noVNC authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

/*
 * Mapping between HTML key values and VNC/X11 keysyms for "special"
 * keys that cannot be handled via their Unicode codepoint.
 *
 * See https://www.w3.org/TR/uievents-key/ for possible values.
 */

var DOMKeyTable = {};

function addStandard(key, standard) {
  if (standard === undefined) throw new Error("Undefined keysym for key \"" + key + "\"");
  if (key in DOMKeyTable) throw new Error("Duplicate entry for key \"" + key + "\"");
  DOMKeyTable[key] = [standard, standard, standard, standard];
}

function addLeftRight(key, left, right) {
  if (left === undefined) throw new Error("Undefined keysym for key \"" + key + "\"");
  if (right === undefined) throw new Error("Undefined keysym for key \"" + key + "\"");
  if (key in DOMKeyTable) throw new Error("Duplicate entry for key \"" + key + "\"");
  DOMKeyTable[key] = [left, left, right, left];
}

function addNumpad(key, standard, numpad) {
  if (standard === undefined) throw new Error("Undefined keysym for key \"" + key + "\"");
  if (numpad === undefined) throw new Error("Undefined keysym for key \"" + key + "\"");
  if (key in DOMKeyTable) throw new Error("Duplicate entry for key \"" + key + "\"");
  DOMKeyTable[key] = [standard, standard, standard, numpad];
}

// 3.2. Modifier Keys

addLeftRight("Alt", _keysym["default"].XK_Alt_L, _keysym["default"].XK_Alt_R);
addStandard("AltGraph", _keysym["default"].XK_ISO_Level3_Shift);
addStandard("CapsLock", _keysym["default"].XK_Caps_Lock);
addLeftRight("Control", _keysym["default"].XK_Control_L, _keysym["default"].XK_Control_R);

// - Fn
// - FnLock
addLeftRight("Meta", _keysym["default"].XK_Super_L, _keysym["default"].XK_Super_R);
addStandard("NumLock", _keysym["default"].XK_Num_Lock);
addStandard("ScrollLock", _keysym["default"].XK_Scroll_Lock);
addLeftRight("Shift", _keysym["default"].XK_Shift_L, _keysym["default"].XK_Shift_R);

// - Symbol
// - SymbolLock
// - Hyper
// - Super

// 3.3. Whitespace Keys

addNumpad("Enter", _keysym["default"].XK_Return, _keysym["default"].XK_KP_Enter);
addStandard("Tab", _keysym["default"].XK_Tab);
addNumpad(" ", _keysym["default"].XK_space, _keysym["default"].XK_KP_Space);

// 3.4. Navigation Keys

addNumpad("ArrowDown", _keysym["default"].XK_Down, _keysym["default"].XK_KP_Down);
addNumpad("ArrowLeft", _keysym["default"].XK_Left, _keysym["default"].XK_KP_Left);
addNumpad("ArrowRight", _keysym["default"].XK_Right, _keysym["default"].XK_KP_Right);
addNumpad("ArrowUp", _keysym["default"].XK_Up, _keysym["default"].XK_KP_Up);
addNumpad("End", _keysym["default"].XK_End, _keysym["default"].XK_KP_End);
addNumpad("Home", _keysym["default"].XK_Home, _keysym["default"].XK_KP_Home);
addNumpad("PageDown", _keysym["default"].XK_Next, _keysym["default"].XK_KP_Next);
addNumpad("PageUp", _keysym["default"].XK_Prior, _keysym["default"].XK_KP_Prior);

// 3.5. Editing Keys

addStandard("Backspace", _keysym["default"].XK_BackSpace);

// Browsers send "Clear" for the numpad 5 without NumLock because
// Windows uses VK_Clear for that key. But Unix expects KP_Begin for
// that scenario.
addNumpad("Clear", _keysym["default"].XK_Clear, _keysym["default"].XK_KP_Begin);
addStandard("Copy", _keysym["default"].XF86XK_Copy);

// - CrSel
addStandard("Cut", _keysym["default"].XF86XK_Cut);
addNumpad("Delete", _keysym["default"].XK_Delete, _keysym["default"].XK_KP_Delete);

// - EraseEof
// - ExSel
addNumpad("Insert", _keysym["default"].XK_Insert, _keysym["default"].XK_KP_Insert);
addStandard("Paste", _keysym["default"].XF86XK_Paste);
addStandard("Redo", _keysym["default"].XK_Redo);
addStandard("Undo", _keysym["default"].XK_Undo);

// 3.6. UI Keys

// - Accept
// - Again (could just be XK_Redo)
// - Attn
addStandard("Cancel", _keysym["default"].XK_Cancel);
addStandard("ContextMenu", _keysym["default"].XK_Menu);
addStandard("Escape", _keysym["default"].XK_Escape);
addStandard("Execute", _keysym["default"].XK_Execute);
addStandard("Find", _keysym["default"].XK_Find);
addStandard("Help", _keysym["default"].XK_Help);
addStandard("Pause", _keysym["default"].XK_Pause);

// - Play
// - Props
addStandard("Select", _keysym["default"].XK_Select);
addStandard("ZoomIn", _keysym["default"].XF86XK_ZoomIn);
addStandard("ZoomOut", _keysym["default"].XF86XK_ZoomOut);

// 3.7. Device Keys

addStandard("BrightnessDown", _keysym["default"].XF86XK_MonBrightnessDown);
addStandard("BrightnessUp", _keysym["default"].XF86XK_MonBrightnessUp);
addStandard("Eject", _keysym["default"].XF86XK_Eject);
addStandard("LogOff", _keysym["default"].XF86XK_LogOff);
addStandard("Power", _keysym["default"].XF86XK_PowerOff);
addStandard("PowerOff", _keysym["default"].XF86XK_PowerDown);
addStandard("PrintScreen", _keysym["default"].XK_Print);
addStandard("Hibernate", _keysym["default"].XF86XK_Hibernate);
addStandard("Standby", _keysym["default"].XF86XK_Standby);
addStandard("WakeUp", _keysym["default"].XF86XK_WakeUp);

// 3.8. IME and Composition Keys

addStandard("AllCandidates", _keysym["default"].XK_MultipleCandidate);
addStandard("Alphanumeric", _keysym["default"].XK_Eisu_toggle);
addStandard("CodeInput", _keysym["default"].XK_Codeinput);
addStandard("Compose", _keysym["default"].XK_Multi_key);
addStandard("Convert", _keysym["default"].XK_Henkan);

// - Dead
// - FinalMode
addStandard("GroupFirst", _keysym["default"].XK_ISO_First_Group);
addStandard("GroupLast", _keysym["default"].XK_ISO_Last_Group);
addStandard("GroupNext", _keysym["default"].XK_ISO_Next_Group);
addStandard("GroupPrevious", _keysym["default"].XK_ISO_Prev_Group);

// - ModeChange (XK_Mode_switch is often used for AltGr)
// - NextCandidate
addStandard("NonConvert", _keysym["default"].XK_Muhenkan);
addStandard("PreviousCandidate", _keysym["default"].XK_PreviousCandidate);

// - Process
addStandard("SingleCandidate", _keysym["default"].XK_SingleCandidate);
addStandard("HangulMode", _keysym["default"].XK_Hangul);
addStandard("HanjaMode", _keysym["default"].XK_Hangul_Hanja);
addStandard("JunjaMode", _keysym["default"].XK_Hangul_Jeonja);
addStandard("Eisu", _keysym["default"].XK_Eisu_toggle);
addStandard("Hankaku", _keysym["default"].XK_Hankaku);
addStandard("Hiragana", _keysym["default"].XK_Hiragana);
addStandard("HiraganaKatakana", _keysym["default"].XK_Hiragana_Katakana);
addStandard("KanaMode", _keysym["default"].XK_Kana_Shift); // could also be _Kana_Lock
addStandard("KanjiMode", _keysym["default"].XK_Kanji);
addStandard("Katakana", _keysym["default"].XK_Katakana);
addStandard("Romaji", _keysym["default"].XK_Romaji);
addStandard("Zenkaku", _keysym["default"].XK_Zenkaku);
addStandard("ZenkakuHankaku", _keysym["default"].XK_Zenkaku_Hankaku);

// 3.9. General-Purpose Function Keys

addStandard("F1", _keysym["default"].XK_F1);
addStandard("F2", _keysym["default"].XK_F2);
addStandard("F3", _keysym["default"].XK_F3);
addStandard("F4", _keysym["default"].XK_F4);
addStandard("F5", _keysym["default"].XK_F5);
addStandard("F6", _keysym["default"].XK_F6);
addStandard("F7", _keysym["default"].XK_F7);
addStandard("F8", _keysym["default"].XK_F8);
addStandard("F9", _keysym["default"].XK_F9);
addStandard("F10", _keysym["default"].XK_F10);
addStandard("F11", _keysym["default"].XK_F11);
addStandard("F12", _keysym["default"].XK_F12);
addStandard("F13", _keysym["default"].XK_F13);
addStandard("F14", _keysym["default"].XK_F14);
addStandard("F15", _keysym["default"].XK_F15);
addStandard("F16", _keysym["default"].XK_F16);
addStandard("F17", _keysym["default"].XK_F17);
addStandard("F18", _keysym["default"].XK_F18);
addStandard("F19", _keysym["default"].XK_F19);
addStandard("F20", _keysym["default"].XK_F20);
addStandard("F21", _keysym["default"].XK_F21);
addStandard("F22", _keysym["default"].XK_F22);
addStandard("F23", _keysym["default"].XK_F23);
addStandard("F24", _keysym["default"].XK_F24);
addStandard("F25", _keysym["default"].XK_F25);
addStandard("F26", _keysym["default"].XK_F26);
addStandard("F27", _keysym["default"].XK_F27);
addStandard("F28", _keysym["default"].XK_F28);
addStandard("F29", _keysym["default"].XK_F29);
addStandard("F30", _keysym["default"].XK_F30);
addStandard("F31", _keysym["default"].XK_F31);
addStandard("F32", _keysym["default"].XK_F32);
addStandard("F33", _keysym["default"].XK_F33);
addStandard("F34", _keysym["default"].XK_F34);
addStandard("F35", _keysym["default"].XK_F35);

// - Soft1...

// 3.10. Multimedia Keys

// - ChannelDown
// - ChannelUp
addStandard("Close", _keysym["default"].XF86XK_Close);
addStandard("MailForward", _keysym["default"].XF86XK_MailForward);
addStandard("MailReply", _keysym["default"].XF86XK_Reply);
addStandard("MailSend", _keysym["default"].XF86XK_Send);

// - MediaClose
addStandard("MediaFastForward", _keysym["default"].XF86XK_AudioForward);
addStandard("MediaPause", _keysym["default"].XF86XK_AudioPause);
addStandard("MediaPlay", _keysym["default"].XF86XK_AudioPlay);

// - MediaPlayPause
addStandard("MediaRecord", _keysym["default"].XF86XK_AudioRecord);
addStandard("MediaRewind", _keysym["default"].XF86XK_AudioRewind);
addStandard("MediaStop", _keysym["default"].XF86XK_AudioStop);
addStandard("MediaTrackNext", _keysym["default"].XF86XK_AudioNext);
addStandard("MediaTrackPrevious", _keysym["default"].XF86XK_AudioPrev);
addStandard("New", _keysym["default"].XF86XK_New);
addStandard("Open", _keysym["default"].XF86XK_Open);
addStandard("Print", _keysym["default"].XK_Print);
addStandard("Save", _keysym["default"].XF86XK_Save);
addStandard("SpellCheck", _keysym["default"].XF86XK_Spell);

// 3.11. Multimedia Numpad Keys

// - Key11
// - Key12

// 3.12. Audio Keys

// - AudioBalanceLeft
// - AudioBalanceRight
// - AudioBassBoostDown
// - AudioBassBoostToggle
// - AudioBassBoostUp
// - AudioFaderFront
// - AudioFaderRear
// - AudioSurroundModeNext
// - AudioTrebleDown
// - AudioTrebleUp
addStandard("AudioVolumeDown", _keysym["default"].XF86XK_AudioLowerVolume);
addStandard("AudioVolumeUp", _keysym["default"].XF86XK_AudioRaiseVolume);
addStandard("AudioVolumeMute", _keysym["default"].XF86XK_AudioMute);

// - MicrophoneToggle
// - MicrophoneVolumeDown
// - MicrophoneVolumeUp
addStandard("MicrophoneVolumeMute", _keysym["default"].XF86XK_AudioMicMute);

// 3.13. Speech Keys

// - SpeechCorrectionList
// - SpeechInputToggle

// 3.14. Application Keys

addStandard("LaunchApplication1", _keysym["default"].XF86XK_MyComputer);
addStandard("LaunchApplication2", _keysym["default"].XF86XK_Calculator);
addStandard("LaunchCalendar", _keysym["default"].XF86XK_Calendar);

// - LaunchContacts
addStandard("LaunchMail", _keysym["default"].XF86XK_Mail);
addStandard("LaunchMediaPlayer", _keysym["default"].XF86XK_AudioMedia);
addStandard("LaunchMusicPlayer", _keysym["default"].XF86XK_Music);
addStandard("LaunchPhone", _keysym["default"].XF86XK_Phone);
addStandard("LaunchScreenSaver", _keysym["default"].XF86XK_ScreenSaver);
addStandard("LaunchSpreadsheet", _keysym["default"].XF86XK_Excel);
addStandard("LaunchWebBrowser", _keysym["default"].XF86XK_WWW);
addStandard("LaunchWebCam", _keysym["default"].XF86XK_WebCam);
addStandard("LaunchWordProcessor", _keysym["default"].XF86XK_Word);

// 3.15. Browser Keys

addStandard("BrowserBack", _keysym["default"].XF86XK_Back);
addStandard("BrowserFavorites", _keysym["default"].XF86XK_Favorites);
addStandard("BrowserForward", _keysym["default"].XF86XK_Forward);
addStandard("BrowserHome", _keysym["default"].XF86XK_HomePage);
addStandard("BrowserRefresh", _keysym["default"].XF86XK_Refresh);
addStandard("BrowserSearch", _keysym["default"].XF86XK_Search);
addStandard("BrowserStop", _keysym["default"].XF86XK_Stop);

// 3.16. Mobile Phone Keys

// - A whole bunch...

// 3.17. TV Keys

// - A whole bunch...

// 3.18. Media Controller Keys

// - A whole bunch...
addStandard("Dimmer", _keysym["default"].XF86XK_BrightnessAdjust);
addStandard("MediaAudioTrack", _keysym["default"].XF86XK_AudioCycleTrack);
addStandard("RandomToggle", _keysym["default"].XF86XK_AudioRandomPlay);
addStandard("SplitScreenToggle", _keysym["default"].XF86XK_SplitScreen);
addStandard("Subtitle", _keysym["default"].XF86XK_Subtitle);
addStandard("VideoModeNext", _keysym["default"].XF86XK_Next_VMode);

// Extra: Numpad

addNumpad("=", _keysym["default"].XK_equal, _keysym["default"].XK_KP_Equal);
addNumpad("+", _keysym["default"].XK_plus, _keysym["default"].XK_KP_Add);
addNumpad("-", _keysym["default"].XK_minus, _keysym["default"].XK_KP_Subtract);
addNumpad("*", _keysym["default"].XK_asterisk, _keysym["default"].XK_KP_Multiply);
addNumpad("/", _keysym["default"].XK_slash, _keysym["default"].XK_KP_Divide);
addNumpad(".", _keysym["default"].XK_period, _keysym["default"].XK_KP_Decimal);
addNumpad(",", _keysym["default"].XK_comma, _keysym["default"].XK_KP_Separator);
addNumpad("0", _keysym["default"].XK_0, _keysym["default"].XK_KP_0);
addNumpad("1", _keysym["default"].XK_1, _keysym["default"].XK_KP_1);
addNumpad("2", _keysym["default"].XK_2, _keysym["default"].XK_KP_2);
addNumpad("3", _keysym["default"].XK_3, _keysym["default"].XK_KP_3);
addNumpad("4", _keysym["default"].XK_4, _keysym["default"].XK_KP_4);
addNumpad("5", _keysym["default"].XK_5, _keysym["default"].XK_KP_5);
addNumpad("6", _keysym["default"].XK_6, _keysym["default"].XK_KP_6);
addNumpad("7", _keysym["default"].XK_7, _keysym["default"].XK_KP_7);
addNumpad("8", _keysym["default"].XK_8, _keysym["default"].XK_KP_8);
addNumpad("9", _keysym["default"].XK_9, _keysym["default"].XK_KP_9);
var _default = exports["default"] = DOMKeyTable;