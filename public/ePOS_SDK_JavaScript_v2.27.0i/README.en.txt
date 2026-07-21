=========================================================================
          Epson ePOS SDK for JavaScript Version 2.27.0i

          Copyright (C) Seiko Epson Corporation 2016 - 2026 All rights reserved.
=========================================================================

1.Note
The Epson ePOS SDK for JavaScript is an SDK aimed at development engineers who are
developing Web applications for printing on an EPSON TM printer and an EPSON TMIntelligent
printer.

2. Environment
  [Supported Web Browsers]
    - Microsoft Edge 25 to 125
    - Mozilla Firefox 12.0 to 108
    - Google Chrome 21 to 125
    - Safari 4 to 16.6
    - Safari in iOS 5 to 16.6

  [Support interface]
    [TM Printer]
      - Wired LAN
      - Wireless LAN
    [TM-Intelligent Printer]
      - Wired LAN
    [TM-T88VI-iHUB]
      - Wired LAN
      - Wireless LAN

3. Supported Products
  For detailed information, please see Epson ePOS SDK for JavaScript User's 
  Manual.

4. Supplied Files

- epos-2.27.0.js
  A library for function execution

- ePOS_SDK_Sample_JavaScript.zip
  Sample scripts

- DeviceControlScript_Sample.zip
  This file contains sample device control script programs

- DeviceControlProgram_Sample.zip
  This file contains sample device control programs

- EULA.en.txt
  Contains the SOFTWARE LICENSE AGREEMENT

- EULA.ja.txt
  Contains the SOFTWARE LICENSE AGREEMENT (The Japanese edition)

- ePOS_SDK_JavaScript_um_en_revx.pdf
  An user's manual

- ePOS_SDK_JavaScript_um_ja_revx.pdf
  An user's manual (The Japanese edition)

- ePOS_SDK_JavaScript_Migration_Guide_en_revx.pdf
  A migration guide

- ePOS_SDK_JavaScript_Migration_Guide_ja_revx.pdf
  A migration guide (The Japanese edition)

- TM-DT_Peripherals_en_revx.pdf
  This is the TM-DT Series Peripheral Device Control Guide

- TM-DT_Peripherals_ja_revx.pdf
  This is the TM-DT Series Peripheral Device Control Guide (The Japanese edition)

- SB-H50_Peripherals_ja_revx.pdf
  This is the SB-H50 Peripheral Device Control Guide (The Japanese edition)

- README.en.txt
  This file

- README.ja.txt
  The Japanese edition of this file

- OPOS_CCOs_1.14.001.msi
  This is the OPOS CCO installer package

5. Remarks

- Returns RequestEntityTooLarge if the print data at a time is sent over
  the allowable amount of the printer firmware.

- Returns TooManyRequests if the number of print jobs or data to be displayed
  on a display has exceeded the allowable limit of the printer's firmware.

- For detailed information, please see Epson ePOS SDK for JavaScript User's
  Manual.

6. Restriction

7. Version History 

  Version 2.27.0i
    - The library is the same as Ver.2.27.0.
    - Minor updates to EULA.

  Version 2.27.0h

    - The library is the same as Ver.2.27.0.
    [Function change]
      - Updated the user’s manual.

  Version 2.27.0g

    - The library is the same as Ver.2.27.0.
    [Updated support model]
      - SB-m30 Japanese model

  Version 2.27.0f
    - The library is the same as Ver.2.27.0.
    [Function change]
      - The software license agreement has been updated.

  Version 2.27.0e
    - The library is the same as Ver.2.27.0.
    [Added Web Browser version support]
      - Microsoft Edge 108 - 125
      - Google Chrome 108 - 125
      - Safari 15.6.1 - 16.6
      - Safari in iOS 16.0 - 16.6
    [Function change]
      - Added SB-H50 Peripheral Device Control Guide.

  Version 2.27.0d
    - The library is the same as Ver.2.27.0.
    [Updated support model]
      - TM-T20IV
      - TM-T20IV-SP
      - TM-T82IV

  Version 2.27.0c
    - The library is the same as Ver.2.27.0.
    [Updated support model]
      ・SB-H50 Japanese model

  Version 2.27.0b
    - The library is the same as Ver.2.27.0.
    [Updated support model]
      ・TM-U220II

  Version 2.27.0a
    - The library is the same as Ver.2.27.0.
    [Function change]
      - The software license agreement has been updated.

  Version 2.27.0
    - Added new functions for Japanese users.

  Version 2.24.0b
    - The library is the same as Ver.2.24.0.
    - Updated sample to use Automatic certificate update feature.
    - Removed support Web Browser
      - Windows Internet Explorer 8 - 11

  Version 2.24.0a
    - The library is the same as Ver.2.24.0.
    - Added TM printer support
      - TM-m50II-H

  Version 2.24.0
    - Added TM printer support
      - TM-m50II

  Version 2.23.0
    - Added TM printer support
      - TM-m30III
      - TM-m30III-H
    - Bug fix
      - Fixed the print method fails after executing the startMonitor method.
    - Added Web Browser version support
      - Microsoft Edge 100 - 108
      - Mozilla Firefox 99 - 108
      - Google Chrome 100 - 108
      - Safari 15.4 - 15.6.1
      - Safari iOS向け 15.4 - 16.0

  Version 2.22.0
    - Added TM printer support
      - TM-P20II
      - TM-P80II
    - Bug fix
      - Fixed the phenomenon that the callback is issued twice when an error occurs in the connect method.
    - Added Web Browser version support
      - Microsoft Edge 91 - 100
      - Mozilla Firefox 88 - 99
      - Google Chrome 91 - 100
      - Safari 14 - 15.4
      - Safari in iOS 14 - 15.4 
    - Added new functions
      - Added full-cut parameter on addCut method.

  Version 2.20.0
    - Added TM printer support
      - TM-L100

  Version 2.18.0
    - Added Web Browser version support
      - Microsoft Edge 45 - 90
      - Mozilla Firefox 67 - 87
      - Google Chrome 79 - 90
      - Safari 13 - 14
      - Safari in iOS 13 - 14
    - Added TM Printer support
      - TM-T88VII
    - Bug fix
      - Fixed the phenomenon that cookies continue to remain.

  Version 2.17.0
    - Added customer display support
      - DM-D70

  Version 2.16.0
    - Added TM printer support
      - TM-m30II-S
      - TM-m30II-NT
      - TM-m50
    - Added new functions
      - Added "CODE128 auto" parameter on addBarcode method. 

  Version 2.14.0
    - Added TM printer support
      - TM-m30II
      - TM-m30II-H
    - Added new functions
      - Batch rotate printing
      - UTF-8 printing

  Version 2.13.0
    - Added Web Browser version support
      - Google Chrome 75 - 78
    - Added new function
      - GermanyFiscalElement class

  Version 2.12.0
    - Added Web Browser version support
      - Microsoft Edge 39 - 44
      - Mozilla Firefox 50 - 66
      - Google Chrome 54 - 74
      - Safari 11 - 12
      - Safari in iOS 11 - 12
    - Added TM printer support
      - TM-T20III
      - TM-T82III
    - Barcode scanner can now be connected to TM-T88VI.
    - Connect API can be used for multiple devices form one application.

  Version 2.9.0a
    - The library is the same as Ver.2.9.0.
    - Added TM printer support
      - TM-T70II-DT2
      - TM-T88VI-DT2

  Version 2.9.0
    - Barcode scanner can now be connected to TM-m30.
    - The disconnection detection time can be set on the TM-DT side.
    - Bug fix
      - We added the following files missing from package.
        - DeviceControlProgram_Sample.zip
        - TM-DT_Peripherals_ja_revx.pdf
        - TM-DT_Peripherals_en_revx.pdf
        - OPOS_CCOs_1.14.001.msi

  Version 2.7.0
    - Added TM printer support
      - TM-H6000V
    - Added support device
      - DM-D210
    - Added devices class support
      - HybridPrinter2 class
    - Bug fix
      - Fix the phenomenon MICR can not eject in HybridPrinter sample.

  Version 2.6.0
    - Added TM printer support
      - TM-T88VI Japanese model
    - Added peripheral devices support
      - POSKeyboard class 
      - OtherPeripheral class 
    - Added DirectIO command transmission to sendCommand API in CashChanger class.
    - Added the following to the package
      - Sample of device control programs
      - TM-DT Series Peripheral Device Control Guide
      - OPOS CCO installer package
    - Bug fix
      - Fix the phenomenon in which the onstatuschange event is notified after
        the printer is disconnected.

  Version 2.3.0c
    - Corrected the mistake of user's manual (The Japanese-language edition).

  Version 2.3.0b
    - Added TM printer support
      - TM-P80 Japanese model

  Version 2.3.0a
    - Added Web Browser version support
      - Microsoft Edge 26 - 38
      - Mozilla Firefox 44 - 49
      - Google Chrome 48 - 53
      - Safari 10
      - Safari in iOS 10
    - Added multi-lingual keyboard support
    - Added TM printer support
      - TM-T88VI-iHUB

  Version 2.3.0
    - Added TM printer support
      - TM-m30 Korean model
    - Bug fix
      - Fix the phenomenon that the callback function sometimes has not been called
        after call the connect API function.
      - Fix the phenomenon that unnecessary ondisconnect event may occurred
        when call the connect API function.

  Version 2.1.0
    - Added TM printer support
      - TM-T88VI

  Version 2.0.0
    - New release.



