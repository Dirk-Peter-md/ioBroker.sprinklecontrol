'use strict';

/**
 *
 * @param {any} adapter
 * @param {string} sendMessage
 * @param callback
 */
function sendMessageText(adapter, sendMessage, callback) {
    setTimeout(function () {
        switch (adapter.ObjMessage.notificationsType){
            case 'Telegram':

                if (adapter.ObjMessage.enabled &&
                    adapter.ObjMessage.instance !== '' &&
                    adapter.ObjMessage.instance !== null &&
                    adapter.ObjMessage.instance !== undefined) {
                    if (adapter.debug) {
                        adapter.log.debug('start sendMessageText per Telegram');
                    }
                    // send Telegram Message
                    if ((adapter.ObjMessage.User) && (adapter.ObjMessage.User === 'allTelegramUsers')) {
                        adapter.sendTo(adapter.ObjMessage.instance, 'send', {
                            text: 'SprinkleControl:\n' + sendMessage,
                            disable_notification: adapter.ObjMessage.SilentNotice,
                            parse_mode: 'HTML'
                        });
                    } else {
                        adapter.sendTo(adapter.ObjMessage.instance, 'send', {
                            user: adapter.ObjMessage.User,
                            text: 'SprinkleControl:\n' + sendMessage,
                            disable_notification: adapter.ObjMessage.SilentNotice,
                            parse_mode: 'HTML'
                        });
                    }
                }
                break;

            case 'E-Mail':

                if (adapter.ObjMessage.enabled &&
                    adapter.ObjMessage.instance !== '' &&
                    adapter.ObjMessage.instance !== null &&
                    adapter.ObjMessage.instance !== undefined) {
                    if (adapter.debug) {
                        adapter.log.debug('start sendMessageText per E-Mail on used E-Mail-Instance: ${adapter.ObjMessage.instance}');
                    }
                    // Send E-Mail Message
                    adapter.sendTo(adapter.ObjMessage.instance, 'send', {
                        text: 'SprinkleControl:\n' + sendMessage,
                        to: adapter.ObjMessage.emailReceiver,
                        subject: 'SprinkleControl',
                        from: adapter.ObjMessage.emailSender
                    });
                }
                break;

            case 'Pushover' :

                if (adapter.ObjMessage.enabled &&
                    adapter.ObjMessage.instance !== '' &&
                    adapter.ObjMessage.instance !== null &&
                    adapter.ObjMessage.instance !== undefined) {
                    if (adapter.debug) {
                        adapter.log.debug('start sendMessageText per E-Mail on used E-Mail-Instance: ${adapter.ObjMessage.instance}');
                    }
                    // Send pushover Message
                    if (adapter.ObjMessage.SilentNotice === 'true' || adapter.ObjMessage.SilentNotice === true) {
                        adapter.sendTo(adapter.ObjMessage.instance, 'send', {
                            message: 'SprinkleControl:\n' + sendMessage,
                            sound: '',
                            priority: -1,
                            title: 'SprinkleControl',
                            device: adapter.ObjMessage.deviceID
                        });
                    } else {
                        adapter.sendTo(adapter.ObjMessage.instance, 'send', {
                            message: 'SprinkleControl:\n' + sendMessage,
                            sound: '',
                            title: 'SprinkleControl',
                            device: adapter.ObjMessage.deviceID
                        });
                    }
                }
                break;

            case 'WhatsApp' :

                if (adapter.ObjMessage.enabled &&
                    adapter.ObjMessage.instance !== '' &&
                    adapter.ObjMessage.instance !== null &&
                    adapter.ObjMessage.instance !== undefined) {
                    if (adapter.debug) {
                        adapter.log.debug(`start sendMessageText per WhatsApp on used WhatsApp-Instance: ${adapter.ObjMessage.instance}`);
                    }
                    // Send WhatsApp Message
                    adapter.sendTo(adapter.ObjMessage.instance, 'send', {text: 'SprinkleControl:\n' + sendMessage});
                }
                break;
        }
        callback();
    }, adapter.ObjMessage.waiting);
}


module.exports = {
    sendMessageText
};