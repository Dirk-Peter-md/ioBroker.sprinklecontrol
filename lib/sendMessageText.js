'use strict';
/*
 info:  log aufbau sendMessageText.js: #4.*
 */
/**
 * The adapter instance
 *
 */
let adapter;
let ObjMessage = {};

/**
 * Modul zum Versenden von Nachrichten mittels Telegram, E-Mail, Pushover oder WhatsApp
 * der passende Adapter muss installiert sein!
 *
 */
const sendMessageText = {

    /**
     *
     * @param myAdapter - Kopie von Adapter main.js
     */
    initConfigMessage (myAdapter) {
        adapter = myAdapter;
        switch (adapter.config.notificationsType) {
            case 'Telegram':
                ObjMessage = {  enabled: adapter.config.notificationEnabled || false,   notificationsType: adapter.config.notificationsType,   type: 'message',   instance: adapter.config.telegramInstance,  silentNotice: adapter.config.telegramSilentNotice,  noticeType: (adapter.config.telegramNoticeType === 'longTelegramNotice'),   user: adapter.config.telegramUser,  onlyError: adapter.config.telegramOnlyError,   waiting: (Math.round(adapter.config.telegramWaitToSend) * 1000) || 0
                };
                break;

            case 'E-Mail':
                ObjMessage = {  enabled: adapter.config.notificationEnabled || false,   notificationsType: adapter.config.notificationsType,   type: 'message',   instance: adapter.config.emailInstance,  noticeType: (adapter.config.emailNoticeType === 'longEmailNotice'),   emailReceiver: adapter.config.emailReceiver,   emailSender: adapter.config.emailSender,  onlyError: adapter.config.emailOnlyError,   waiting: (Math.round(adapter.config.emailWaitToSend) * 1000) || 0
                };
                break;

            case 'Pushover':
                ObjMessage = {  enabled: adapter.config.notificationEnabled || false,   notificationsType: adapter.config.notificationsType,   type: 'message',   sound: adapter.config.pushoverSound,   instance: adapter.config.pushoverInstance,  silentNotice: adapter.config.pushoverSilentNotice,  noticeType: (adapter.config.pushoverNoticeType === 'longPushoverNotice'),   deviceID: adapter.config.pushoverDeviceID,  onlyError: adapter.config.pushoverOnlyError,   waiting: (Math.round(adapter.config.pushoverWaitToSend) * 1000) || 0
                };
                break;

            case 'WhatsApp':
                ObjMessage = {  enabled: adapter.config.notificationEnabled || false,   notificationsType: adapter.config.notificationsType,   type: 'message',   instance: adapter.config.whatsappInstance,  noticeType: (adapter.config.whatsappNoticeType === 'longWhatsappNotice'),  onlyError: adapter.config.whatsappOnlyError,   waiting: (Math.round(adapter.config.whatsappWaitToSend) * 1000) || 0
                };
                break;
        }
    },
    /**
     * send Message ist für Telegram formatiert und muss für andere Empfänger umformatiert werden
     *
     *@param message - Botschaft
     */
    sendMessage (message) {

        let sendMessage = message;

        setTimeout(function () {
            switch (ObjMessage.notificationsType) {
                case 'Telegram':
                    if (ObjMessage.enabled &&
                        ObjMessage.instance !== '' &&
                        ObjMessage.instance !== null &&
                        ObjMessage.instance !== undefined) {
                        adapter.log.debug('start sendMessageText per Telegram');
                        sendMessage = `<b><u>SprinkleControl:</u></b>\n${  sendMessage}`;
                        // send Telegram Message
                        if ((ObjMessage.User) && (ObjMessage.User !== 'allTelegramUsers')) {
                            adapter.sendTo(ObjMessage.instance, 'send', {
                                user: ObjMessage.User,
                                text: sendMessage,
                                disable_notification: ObjMessage.SilentNotice,
                                parse_mode: 'HTML'
                            });
                        } else {
                            adapter.sendTo(ObjMessage.instance, 'send', {
                                text: sendMessage,
                                disable_notification: ObjMessage.SilentNotice,
                                parse_mode: 'HTML'
                            });
                        }
                    }
                    break;

                case 'E-Mail':

                    if (ObjMessage.enabled &&
                        ObjMessage.instance !== '' &&
                        ObjMessage.instance !== null &&
                        ObjMessage.instance !== undefined) {
                        sendMessage = `<b><u>SprinkleControl:</u></b>\n${  sendMessage}`;
                        sendMessage = sendMessage.replace(/\n/g, '<br />');
                        adapter.log.debug(`start sendMessageText per E-Mail on used E-Mail-Instance: ${ObjMessage.instance}`);
                        // Send E-Mail Message
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            html: sendMessage,
                            to: ObjMessage.emailReceiver,
                            subject: 'SprinkleControl',
                            from: ObjMessage.emailSender
                        });
                    }
                    break;

                case 'Pushover' :

                    if (ObjMessage.enabled &&
                        ObjMessage.instance !== '' &&
                        ObjMessage.instance !== null &&
                        ObjMessage.instance !== undefined) {
                        adapter.log.debug(`start sendMessageText per E-Mail on used E-Mail-Instance: ${ObjMessage.instance}`);
                        // Send pushover Message
                        if (ObjMessage.SilentNotice === 'true' || ObjMessage.SilentNotice === true) {
                            adapter.sendTo(ObjMessage.instance, 'send', {
                                message: sendMessage,
                                sound: ObjMessage.sound,
                                priority: -1,
                                html: 1,
                                title: 'SprinkleControl',
                                device: ObjMessage.deviceID
                            });
                        } else {
                            adapter.sendTo(ObjMessage.instance, 'send', {
                                message: sendMessage,
                                sound: ObjMessage.sound,
                                html: 1,
                                title: 'SprinkleControl',
                                device: ObjMessage.deviceID
                            });
                        }
                    }
                    break;

                case 'WhatsApp' :
                    if (ObjMessage.enabled &&
                        ObjMessage.instance !== '' &&
                        ObjMessage.instance !== null &&
                        ObjMessage.instance !== undefined) {
                        sendMessage = `<b><u>SprinkleControl:</u></b>\n${  sendMessage}`;
                        sendMessage = sendMessage.replace(/\n/g,'%0A');   // Zeilenumbruch
                        sendMessage = sendMessage.replace(/<b>|<\/b>/g, '*');   // Fett Bold
                        sendMessage = sendMessage.replace(/<i>|<\/i>/g, '_');   // kursive Italic
                        sendMessage = sendMessage.replace(/<u>|<\/u>/g, '');     // unterstrichen
                        adapter.log.debug(`start sendMessageText per WhatsApp on used WhatsApp-Instance: ${ObjMessage.instance}`);
                        // Send WhatsApp Message
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            text: sendMessage
                        });
                    }
                    break;
            }
        }, ObjMessage.waiting);
    },

    /**
     * Nachrichtenversandabfrage => true (Ja)
     *
     * @returns
     */
    onlySendError () {
        return (adapter.config.notificationEnabled && adapter.config.notificationsType && ObjMessage.onlyError);
    }

};

module.exports = sendMessageText;