'use strict';
/*
 info:  log aufbau sendMessageText.js: #4.*
 */
/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;
/**
 *
 * @type {{}}
 */
let ObjMessage = {};
/**
 * Modul zum versenden von Nachrichten mittels Telegram, E-Mail, Pushover oder WhatsApp
 * Der passende Adapter muss installiert sein!
 * @param {any} adapter
 * @param {object} ObjMessage
 */
const sendMessageText = {

    /**
     *
     * @param {ioBroker.Adapter} myAdapter - Kopie von Adapter main.js
     */
    initConfigMessage: (myAdapter) => {
        adapter = myAdapter;
        switch (adapter.config.notificationsType) {
            case 'Telegram':
                ObjMessage = {
                    /** @type {boolean} */  enabled: adapter.config.notificationEnabled || false,
                    /** @type {string} */   notificationsType: adapter.config.notificationsType,
                    /** @type {string} */   type: 'message',
                    /** @type {string} */   instance: adapter.config.telegramInstance,
                    /** @type {boolean} */  silentNotice: adapter.config.telegramSilentNotice,
                    /** @type {boolean} */  noticeType: (adapter.config.telegramNoticeType === 'longTelegramNotice'),
                    /** @type {string} */   user: adapter.config.telegramUser,
                    /** @type {boolean} */  onlyError: adapter.config.telegramOnlyError,
                    /** @type {number} */   waiting: parseInt(adapter.config.telegramWaitToSend) * 1000
                };
                break;

            case 'E-Mail':
                ObjMessage = {
                    /** @type {boolean} */  enabled: adapter.config.notificationEnabled || false,
                    /** @type {string} */   notificationsType: adapter.config.notificationsType,
                    /** @type {string} */   type: 'message',
                    /** @type {string} */   instance: adapter.config.emailInstance,
                    /** @type {boolean} */  noticeType: (adapter.config.emailNoticeType === 'longEmailNotice'),
                    /** @type {string} */   emailReceiver: adapter.config.emailReceiver,
                    /** @type {string} */   emailSender: adapter.config.emailSender,
                    /** @type {boolean} */  onlyError: adapter.config.emailOnlyError,
                    /** @type {number} */   waiting: parseInt(adapter.config.emailWaitToSend) * 1000
                };
                break;

            case 'Pushover':
                ObjMessage = {
                    /** @type {boolean} */  enabled: adapter.config.notificationEnabled || false,
                    /** @type {string} */   notificationsType: adapter.config.notificationsType,
                    /** @type {string} */   type: 'message',
                    /** @type {string} */   sound: adapter.config.pushoverSound,
                    /** @type {string} */   instance: adapter.config.pushoverInstance,
                    /** @type {boolean} */  silentNotice: adapter.config.pushoverSilentNotice,
                    /** @type {boolean} */  noticeType: (adapter.config.pushoverNoticeType === 'longPushoverNotice'),
                    /** @type {string} */   deviceID: adapter.config.pushoverDeviceID,
                    /** @type {boolean} */  onlyError: adapter.config.pushoverOnlyError,
                    /** @type {number} */   waiting: parseInt(adapter.config.pushoverWaitToSend) * 1000
                };
                break;

            case 'WhatsApp':
                ObjMessage = {
                    /** @type {boolean} */  enabled: adapter.config.notificationEnabled || false,
                    /** @type {string} */   notificationsType: adapter.config.notificationsType,
                    /** @type {string} */   type: 'message',
                    /** @type {string} */   instance: adapter.config.whatsappInstance,
                    /** @type {boolean} */  noticeType: (adapter.config.whatsappNoticeType === 'longWhatsappNotice'),
                    /** @type {boolean} */  onlyError: adapter.config.whatsappOnlyError,
                    /** @type {number} */   waiting: parseInt(adapter.config.whatsappWaitToSend) * 1000
                };
                break;
        }
    },
    /**
     * send Message ist für Telegram formatiert und muss für andere Empfänger umformatiert werden
     *@param {string} message - Botschaft
     */
    sendMessage: (message) => {

        let sendMessage = message;

        setTimeout(function () {
            switch (ObjMessage.notificationsType) {
                case 'Telegram':
                    if (ObjMessage.enabled &&
                        ObjMessage.instance !== '' &&
                        ObjMessage.instance !== null &&
                        ObjMessage.instance !== undefined) {
                        if (adapter.config.debug) {
                            adapter.log.debug('start sendMessageText per Telegram');
                        }
                        sendMessage = '<b><u>SprinkleControl:</u></b>\n' + sendMessage;
                        // send Telegram Message
                        if ((ObjMessage.User) && (ObjMessage.User === 'allTelegramUsers')) {
                            adapter.sendTo(ObjMessage.instance, 'send', {
                                text: sendMessage,
                                disable_notification: ObjMessage.SilentNotice,
                                parse_mode: 'HTML'
                            });
                        } else {
                            adapter.sendTo(ObjMessage.instance, 'send', {
                                user: ObjMessage.User,
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
                        sendMessage = '<b><u>SprinkleControl:</u></b>\n' + sendMessage;
                        sendMessage = sendMessage.replace(/\n/g, '<br />');
                        if (adapter.config.debug) {
                            adapter.log.debug('start sendMessageText per E-Mail on used E-Mail-Instance: ${adapter.ObjMessage.instance}');
                        }
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
                        if (adapter.config.debug) {
                            adapter.log.debug('start sendMessageText per E-Mail on used E-Mail-Instance: ${adapter.ObjMessage.instance}');
                        }
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
                        sendMessage = '<b><u>SprinkleControl:</u></b>\n' + sendMessage;
                        sendMessage = sendMessage.replace(/<b>|<\/b>/g, '*');   // Fett Bold
                        sendMessage = sendMessage.replace(/<i>|<\/i>/g, '_');   // kursive Italic
                        sendMessage = sendMessage.replace(/<u>|<\/u>/g, '');     // unterstrichen
                        if (adapter.config.debug) {
                            adapter.log.debug(`start sendMessageText per WhatsApp on used WhatsApp-Instance: ${ObjMessage.instance}`);
                        }
                        // Send WhatsApp Message
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            text: sendMessage
                        });
                    }
                    break;
            }
        }, ObjMessage.waiting);
    },

    onlySendError: () => {
        return (adapter.config.notificationEnabled && ObjMessage.onlyError);
    }

}

module.exports = sendMessageText;