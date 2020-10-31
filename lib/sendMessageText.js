'use strict';

/**
 * Modul zum versenden von Nachrichten mittels Telegram, E-Mail, Pushover oder WhatsApp
 * Der passende Adapter muss installiert sein!
 * @param {any} adapter
 * @param {object} ObjMessage
 */
function sendMessageText(adapter, ObjMessage) {
    setTimeout(function () {
        switch (ObjMessage.notificationsType){
            case 'Telegram':

                if (ObjMessage.enabled &&
                    ObjMessage.instance !== '' &&
                    ObjMessage.instance !== null &&
                    ObjMessage.instance !== undefined) {
                    if (adapter.debug) {
                        adapter.log.debug('start sendMessageText per Telegram');
                    }
                    // send Telegram Message
                    if ((ObjMessage.User) && (ObjMessage.User === 'allTelegramUsers')) {
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            text: '<b><u> SprinkleControl:</b></u>\n' + ObjMessage.messageText,
                            disable_notification: ObjMessage.SilentNotice,
                            parse_mode: 'HTML'
                        });
                    } else {
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            user: ObjMessage.User,
                            text: 'SprinkleControl:\n' + ObjMessage.messageText,
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
                    if (adapter.debug) {
                        adapter.log.debug('start sendMessageText per E-Mail on used E-Mail-Instance: ${adapter.ObjMessage.instance}');
                    }
                    // Send E-Mail Message
                    adapter.sendTo(ObjMessage.instance, 'send', {
                        text: 'SprinkleControl:\n' + ObjMessage.messageText,
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
                    if (adapter.debug) {
                        adapter.log.debug('start sendMessageText per E-Mail on used E-Mail-Instance: ${adapter.ObjMessage.instance}');
                    }
                    // Send pushover Message
                    if (ObjMessage.SilentNotice === 'true' || ObjMessage.SilentNotice === true) {
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            message: 'SprinkleControl:\n' + ObjMessage.messageText,
                            sound: '',
                            priority: -1,
                            title: 'SprinkleControl',
                            device: ObjMessage.deviceID
                        });
                    } else {
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            message: 'SprinkleControl:\n' + ObjMessage.messageText,
                            sound: '',
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
                    if (adapter.debug) {
                        adapter.log.debug(`start sendMessageText per WhatsApp on used WhatsApp-Instance: ${ObjMessage.instance}`);
                    }
                    // Send WhatsApp Message
                    adapter.sendTo(ObjMessage.instance, 'send', {text: 'SprinkleControl:\n' + ObjMessage.messageText});
                }
                break;
        }
    }, ObjMessage.waiting);
}


module.exports = sendMessageText;