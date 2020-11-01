'use strict';

/**
 * Modul zum versenden von Nachrichten mittels Telegram, E-Mail, Pushover oder WhatsApp
 * Der passende Adapter muss installiert sein!
 * @param {any} adapter
 * @param {object} ObjMessage
 */
function sendMessageText(adapter, ObjMessage) {
    /**
     * send Message ist für Telegram formatiert und muss für andere Empfänger umformatiert werden
     * @type {string}
     */
    let sendMessage;
    sendMessage = ObjMessage.messageText;
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
                    if (adapter.debug) {
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
                    if (adapter.debug) {
                        adapter.log.debug('start sendMessageText per E-Mail on used E-Mail-Instance: ${adapter.ObjMessage.instance}');
                    }
                    // Send pushover Message
                    if (ObjMessage.SilentNotice === 'true' || ObjMessage.SilentNotice === true) {
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            message: sendMessage,
                            sound: '',
                            priority: -1,
                            html: 1,
                            title: 'SprinkleControl',
                            device: ObjMessage.deviceID
                        });
                    } else {
                        adapter.sendTo(ObjMessage.instance, 'send', {
                            message: sendMessage,
                            sound: '',
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
                    sendMessage = sendMessage.replace(/<b>|<\/b>/g,'*');   // Fett Bold
                    sendMessage = sendMessage.replace(/<i>|<\/i>/g,'_');   // kursive Italic
                    sendMessage = sendMessage.replace(/<u>|<\/u>/g,'');     // unterstrichen
                    if (adapter.debug) {
                        adapter.log.debug(`start sendMessageText per WhatsApp on used WhatsApp-Instance: ${ObjMessage.instance}`);
                    }
                    // Send WhatsApp Message
                    adapter.sendTo(ObjMessage.instance, 'send', {
                        text: sendMessage});
                }
                break;
        }
    }, ObjMessage.waiting);
}


module.exports = sendMessageText;