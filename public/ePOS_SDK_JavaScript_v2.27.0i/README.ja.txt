=========================================================================
          Epson ePOS SDK for JavaScript Version 2.27.0i

          Copyright (C) Seiko Epson Corporation 2016 - 2026 All rights reserved.
=========================================================================

1.本ソフトウェアについて

Epson ePOS SDK for JavaScript は、EPSON TMプリンターおよびEPSON 
TMインテリジェントプリンターに印刷するためのWebアプリケーションを
開発する開発者向けSDKです。
Epson ePOS SDK で提供するAPIを使用してアプリケーションを開発します。
詳細は Epson ePOS SDK for JavaScript ユーザーズマニュアル を参照ください。

2. 環境
  [対応Webブラウザーバージョン]
    - Microsoft Edge 25 - 125
    - Mozilla Firefox 12.0 - 108
    - Google Chrome 21 - 125
    - Safari 4 - 16.6
    - Safari iOS向け 5 - 16.6

  [サポートインターフェイス]
    [TMプリンター]
      - 有線LAN
      - 無線LAN
    [TMインテリジェントプリンター]
      - 有線LAN
    [TM-T88VI-iHUB]
      - 有線LAN
      - 無線LAN

3. サポートTMプリンター
詳細は Epson ePOS SDK for JavaScript ユーザーズマニュアル を参照ください。

4.提供ファイル

・epos-2.27.0.js
  機能実行用ライブラリーです。

・ePOS_SDK_Sample_JavaScript.zip
  サンプルプログラムファイルです。

・DeviceControlScript_Sample.zip
  デバイス制御スクリプト用のサンプルプログラムファイルです。

・DeviceControlProgram_Sample.zip
  デバイス制御プログラム用のサンプルプログラムファイルです。

・EULA.ja.txt
  SOFTWARE LICENSE AGREEMENT が記載されています。

・EULA.en.txt
  SOFTWARE LICENSE AGREEMENT（英語版）が記載されています。

・ePOS_SDK_JavaScript_um_ja_revx.pdf
  ユーザーズマニュアルです。

・ePOS_SDK_JavaScript_um_en_revx.pdf
  ユーザーズマニュアル（英語版）です。

・ePOS_SDK_JavaScript_Migration_Guide_ja_revx.pdf
  マイグレーションガイドです。

・ePOS_SDK_JavaScript_Migration_Guide_en_revx.pdf
  マイグレーションガイド（英語版）です。

・TM-DT_Peripherals_ja_revx.pdf
  TM-DT シリーズ周辺機器制御ガイドです。

・TM-DT_Peripherals_en_revx.pdf
  TM-DT シリーズ周辺機器制御ガイド（英語版）です。

・SB-H50_Peripherals_ja_revx.pdf
  SB-H50 周辺機器制御ガイドです。

・README.ja.txt
  本書です。

・README.en.txt
  本書（英語版）です。

・OPOS_CCOs_1.14.001.msi
  OPOS CCO インストーラーパッケージです。

5.その他留意点

・1回あたりの印刷データもしくはディスプレイ表示データが許容量を超えて送信された場合に
  RequestEntityTooLargeを返します。

・印刷データもしくはディスプレイ表示データがプリンターファームウェアの許容量を超えて送信された場合に
  TooManyRequestsを返します。

・使用方法、使用上の注意、等の詳細は、ユーザーズマニュアルを参照し、
  ご使用ください。

6.制限事項

7.バージョン履歴

  Version 2.27.0i
  
    ・ライブラリはVer.2.27.0と同一です。
    ・EULAを一部修正しました。

  Version 2.27.0h

    ・ライブラリはVer.2.27.0と同一です
    [機能変更]
      ・ユーザーズマニュアルを更新しました。

  Version 2.27.0g

    ・ライブラリはVer.2.27.0と同一です
    [サポートTMプリンターの変更]
      ・SB-m30

  Version 2.27.0f
    ・ライブラリはVer.2.27.0と同一です
    [機能変更]
      ・ソフトウェア使用許諾契約書を更新

  Version 2.27.0e
    ・ライブラリはVer.2.27.0と同一です
    [対応ブラウザーバージョンを更新]
      ・Microsoft Edge 108 - 125
      ・Google Chrome 108 - 125
      ・Safari 15.6.1 - 16.6
      ・Safari iOS向け 16.0 - 16.6
    [機能変更]
      ・SB-H50 周辺機器制御ガイドを追加

  Version 2.27.0d
    ・ライブラリはVer.2.27.0と同一です
    [サポートTMプリンターの変更]
      ・TM-T20IV（海外モデルのみ）
      ・TM-T20IV-SP（海外モデルのみ）
      ・TM-T82IV（海外モデルのみ）

  Version 2.27.0c
    ・ライブラリはVer.2.27.0と同一です
    [サポートTMプリンターの変更]
      ・SB-H50

  Version 2.27.0b
    ・ライブラリはVer.2.27.0と同一です
    [サポートTMプリンターの変更]
      ・TM-U220II（海外モデルのみ）

  Version 2.27.0a
    ・ライブラリはVer.2.27.0と同一です
    [機能変更]
      ・ソフトウェア使用許諾契約書を更新しました。

  Version 2.27.0
    ・新機能追加
      ・CATクラスにAPIを追加

  Version 2.24.0b
    ・ライブラリはVer.2.24.0と同一です。
    ・証明書自動更新機能を用いるためのサンプルを更新しました。
    ・対応ブラウザーを削除
      ・Windows Internet Explorer 8 - 11

  Version 2.24.0a
    ・ライブラリはVer.2.24.0と同一です。
    ・サポートTMプリンターを追加
      ・TM-m50II-H(海外モデルのみ)

  Version 2.24.0
    ・サポートTMプリンターを追加
      ・TM-m55

  Version 2.23.0
    ・サポートTMプリンターを追加
      ・TM-m30III
      ・TM-m30III-H
    ・不具合修正
      ・startMonitorメソッド実行後にprintメソッドが失敗する現象を修正
    ・対応ブラウザーバージョンを更新
      ・Microsoft Edge 100 - 108
      ・Mozilla Firefox 99 - 108
      ・Google Chrome 100 - 108
      ・Safari 15.4 - 15.6.1
      ・Safari iOS向け 15.4 - 16.0

  Version 2.22.0
    ・サポートTMプリンターを追加
      ・TM-P20II
      ・TM-P80II
    ・不具合修正
      ・connectメソッドでエラー発生時、コールバックが2回発行されてしまう現象を修正
    ・対応ブラウザーバージョンを更新
      ・Microsoft Edge 91 - 100
      ・Mozilla Firefox 88 - 99
      ・Google Chrome 91 - 100
      ・Safari 14 - 15.4
      ・Safari iOS向け 14 - 15.4
    ・新機能追加
      ・PrinterクラスのaddCut メソッドにフルカット関連のパラメータを追加

  Version 2.20.0
    ・サポートTMプリンターを追加
      ・TM-L100
    ・新機能追加
      ・CATクラスにAPIを追加

  Version 2.18.0
    ・対応ブラウザーバージョンを更新
      ・Microsoft Edge 45 - 90
      ・Mozilla Firefox 67 - 87
      ・Google Chrome 79 - 90
      ・Safari 13 - 14
      ・Safari iOS向け 13 - 14
    ・サポートTMプリンターを追加
      ・TM-T88VII
    ・不具合修正
      ・Cookieが残り続ける現象を修正

  Version 2.17.0
    ・サポートカスタマーディスプレイを追加
      ・DM-D70
    ・新機能追加
      ・CATクラスにAPIを追加

  Version 2.16.0
    ・サポートTMプリンターを追加
      ・TM-m30II-S
      ・TM-m30II-NT(海外モデルのみ)
      ・TM-m50(海外モデルのみ)
    ・新機能追加
      ・addBarcode メソッドにCODE128 autoパラメータを追加

  Version 2.14.0
    ・サポートTMプリンターを追加
      ・TM-m30II
      ・TM-m30II-H
    ・新機能追加
      ・まとめ反転印刷に対応
      ・UTF-8の印刷に対応

  Version 2.13.0
    ・対応ブラウザーバージョンを更新
      ・Google Chrome 75 - 78

  Version 2.12.0
    ・対応ブラウザーバージョンを更新
      ・Microsoft Edge 39 - 44
      ・Mozilla Firefox 50 - 66
      ・Google Chrome 54 - 74
      ・Safari 11 - 12
      ・Safari iOS向け 11 - 12
    ・サポートＴＭプリンターを追加
      ・TM-T20III
      ・TM-T82III
    ・TM-T88VIにバーコードスキャナが接続できるようになりました。
    ・同一アプリケーションから複数の機器に接続できるようになりました。

  Version 2.9.0a
    ・ライブラリはVer.2.9.0と同一です。
    ・サポートTMプリンターを追加
      ・TM-T70II-DT2
      ・TM-T88VI-DT2

  Version 2.9.0
    ・TM-m30にバーコードスキャナが接続できるようになりました。
    ・CATクラスにおける変更点
      ・API追加
        ・sendCommand：任意DirectIOコマンド送信
      ・イベント追加
        ・oncommandreply：DirectIOコマンドの実行結果受信
        ・onstatusupdate：OPOSの StatusUpdateEventを通知
      ・ステータス追加
        ・OPOS_CODE_XX：OPOS拡張エラー
    ・切断検知時間をTM-DT側で設定できるようにしました。

  Version 2.7.0
    ・サポートTMプリンターを追加
      ・TM-H6000V（海外モデルのみ）

  Version 2.6.0
    ・サポートTMプリンターを追加
      ・TM-T88VI
    ・サポート周辺機器を追加
      ・POSKeyboardクラス
      ・CATクラス
      ・OtherPeripheralクラス
    ・CashChangerクラスのsendCommand APIに、DirectIOコマンドを送信する機能を追加
    ・CashChangerクラスのdispenseChange APIとdispenseCash APIの仕様を変更
      ・dispenseChange：金種指定→金額指定で出金
      ・dispenseCash：金額指定→金種指定で出金
    ・デバイス制御スクリプト使用時、CashChangerクラスのoncashcountイベントで回収部の紙幣枚数を返すようにしました
    ・パッケージに以下を追加
      ・デバイス制御プログラム用のサンプルプログラム
      ・TM-DT シリーズ周辺機器制御ガイド
      ・OPOS CCO インストーラーパッケージ
    ・不具合修正
     ・プリンター切断後、onstatuschange イベントが通知される現象を修正

  Version 2.3.0c
    ・ユーザーズマニュアルの誤記を修正しました

  Version 2.3.0b
    ・サポートTMプリンターを追加
      ・TM-P80

  Version 2.3.0a
    ・対応ブラウザーバージョンを追加
      ・Microsoft Edge 26 - 38
      ・Mozilla Firefox 44 - 49
      ・Google Chrome 48 - 53
      ・Safari 10
      ・Safari iOS向け 10
    ・サポートTMプリンターを追加
      ・TM-T88VI-iHUB（海外モデルのみ）

  Version 2.3.0
    ・不具合修正
      ・connect API実行時、Callback 関数が呼ばれないことがある現象を修正
      ・connect API実行直後、不要な ondisconnect イベントが通知されることがある
        現象を修正

  Version 2.1.0
    ・サポートTMプリンターを追加
      ・TM-T88VI（海外モデルのみ）

  Version 2.0.0
    ・新規リリース



