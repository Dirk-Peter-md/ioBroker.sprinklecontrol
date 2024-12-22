/**
 * @license
 * iobroker.sprinklecontrol - Copyright (c) by Dirk-Peter-md
 * Please visit https://github.com/Dirk-Peter-md/ioBroker.sprinklecontrol for licence-agreement and further information
 */

//Settings

/**
 * This will be called by the admin adapter when the settings page loads
 * Dies wird vom Adapter Administrator aufgerufen, wenn die Einstellungsseite geladen wird
 * @param {object} settings - represents the adapter config object
 * @param {object} onChange - callback
 */
function load(settings, onChange) {
    // example: select elements with id=key and class=value and insert value
    // Beispiel: Wählen Sie Elemente mit id = key und class = value aus und fügen Sie einen Wert ein
    if (!settings) return;
    $('.value').each(function () {
        const $key = $(this);
        const id = $key.attr('id');

        // check which type of html element
        // do not call onChange direct, because onChange could expect some arguments
        // Rufen Sie onChange nicht direkt auf, da onChange einige Argumente erwarten kann
        if ($key.attr('type') === 'checkbox') {
            $key.prop('checked', settings[id])  // read setting value from adapter config object and set checkbox in config page → Lesen Sie den Einstellungswert aus dem Adapterkonfigurationsobjekt und setzen Sie das Kontrollkästchen auf der Konfigurationsseite
                .on('change', () => {
                    showHideSettings();
                    onChange(); // set listener to checkbox and call onChange if the value has changed => setze listener auf checkbox und rufe onChange auf, wenn sich der Wert geändert hat
                });
        } else {
            $key.val(settings[id])
                .on('change', () => onChange())
                .on('keyup', () => onChange())
            ;
        }
    });


    //var events = [];

    const events = settings.events    || [];

    showHideSettings();

    values2table('events', events, onChange, tableOnReady);

    $('#responseOIDDialog').on('click', function () {
        const devices = table2values('events');
        let id = 0;
        for (let i = 0; i < devices.length; i++) {
            id = id +1;
        }
        setTimeout(function () {
            $('#events .values-input[data-name="enabled"][data-index="' + id + '"]').prop('checked', true);
            $('#events .values-input[data-name="wateringTime"][data-index="' + id + '"]').val('20').trigger('change');
            $('#events .values-input[data-name="wateringAdd"][data-index="' + id + '"]').val('200').trigger('change');
            $('#events .values-input[data-name="wateringInterval"][data-index="' + id + '"]').val('0').trigger('change');
            $('#events .values-input[data-name="addWateringTime"][data-index="' + id + '"]').val('0').trigger('change');
            $('#events .values-input[data-name="addTriggersIrrigation"][data-index="' + id + '"]').val('50').trigger('change');
            $('#events .values-input[data-name="maxSoilMoistureIrrigation"][data-index="' + id + '"]').val('8').trigger('change');
            $('#events .values-input[data-name="maxSoilMoistureRainPct"][data-index="' + id + '"]').val('120').trigger('change');
            $('#events .values-input[data-name="triggersIrrigation"][data-index="' + id + '"]').val('50').trigger('change');
            $('#events .values-input[data-name="pipeFlow"][data-index="' + id + '"]').val('700').trigger('change');
            $('#events .values-input[data-name="methodControlSM"][data-index="' + id + '"]').val('calculation').trigger('change');
            //$('#events .values-input[data-name="methodControlSM"][data-index="' + id + '"]').select().trigger('change');    // select() > val
            //$('#events .values-input[data-name="triggerSM"][data-index="' + id + '"]').val().trigger('change');
            $('#events .values-input[data-name="analogZPct"][data-index="' + id + '"]').val('0').trigger('change');
            $('#events .values-input[data-name="analogOHPct"][data-index="' + id + '"]').val('100').trigger('change');
            $('#events .values-input[data-name="startDay"][data-index="' + id + '"]').val('threeRd').trigger('change');
            //$('#events .values-input[data-name="startDay"][data-index="' + id + '"]').select().trigger('change');
            // boolean
            $('#events .values-input[data-name="booster"][data-index="' + id + '"]').prop('checked', false);
            $('#events .values-input[data-name="endIrrigation"][data-index="' + id + '"]').prop('checked', true);
            $('#events .values-input[data-name="inGreenhouse"][data-index="' + id + '"]').prop('checked', false);

            $('#events .values-input[data-name="sun"][data-index="' + id + '"]').prop('checked', false);
            $('#events .values-input[data-name="mon"][data-index="' + id + '"]').prop('checked', false);
            $('#events .values-input[data-name="tue"][data-index="' + id + '"]').prop('checked', false);
            $('#events .values-input[data-name="wed"][data-index="' + id + '"]').prop('checked', false);
            $('#events .values-input[data-name="thur"][data-index="' + id + '"]').prop('checked', false);
            $('#events .values-input[data-name="fri"][data-index="' + id + '"]').prop('checked', false);
            $('#events .values-input[data-name="sat"][data-index="' + id + '"]').prop('checked', false);

        }, 1000);

        initSelectId(function (sid) {
            sid.selectId('show', $('#events .values-input[data-name="name"][data-index="' + id + '"]').val(), function (newId) {
                if (newId) {
                    $('#events .values-input[data-name="name"][data-index="' + id + '"]').val(newId).trigger('change');
                    socket.emit('getObject', newId, function (err, obj) {
                        const name = getName(obj);
                        $('#events .values-input[data-name="sprinkleName"][data-index="' + id + '"]').val(name).trigger('change');
                    });
                }
            });
        });
    });

    // Registerkarte Sprinkler => Irrigation settings

    $('#triggerSMDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#triggerSM').val(), function (newId) {
                if (newId) {
                    $('#triggerSM').val(newId).trigger('change');
                }
            });
        });
    });

    // Registerkarte Pump Settings

    $('#triggerControlVoltageDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#triggerControlVoltage').val(), function (newId) {
                if (newId) {
                    $('#triggerControlVoltage').val(newId).trigger('change');
                }
            });
        });
    });

    $('#triggerMainPumpDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#triggerMainPump').val(), function (newId) {
                if (newId) {
                    $('#triggerMainPump').val(newId).trigger('change');
                }
            });
        });
    });

    $('#triggerCisternPumpDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#triggerCisternPump').val(), function (newId) {
                if (newId) {
                    $('#triggerCisternPump').val(newId).trigger('change');
                }
            });
        });
    });

    $('#actualValueLevelDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#actualValueLevel').val(), function (newId) {
                if (newId) {
                    $('#actualValueLevel').val(newId).trigger('change');
                }
            });
        });
    });

    // Registerkarte Extra Settings

    $('#sensorOutsideTemperatureDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#sensorOutsideTemperature').val(), function (newId) {
                if (newId) {
                    $('#sensorOutsideTemperature').val(newId).trigger('change');
                }
            });
        });
    });

    $('#sensorOutsideHumidityDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#sensorOutsideHumidity').val(), function (newId) {
                if (newId) {
                    $('#sensorOutsideHumidity').val(newId).trigger('change');
                }
            });
        });
    });

    $('#sensorWindSpeedDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#sensorWindSpeed').val(), function (newId) {
                if (newId) {
                    $('#sensorWindSpeed').val(newId).trigger('change');
                }
            });
        });
    });

    $('#sensorBrightnessDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#sensorBrightness').val(), function (newId) {
                if (newId) {
                    $('#sensorBrightness').val(newId).trigger('change');
                }
            });
        });
    });

    $('#sensorRainfallDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#sensorRainfall').val(), function (newId) {
                if (newId) {
                    $('#sensorRainfall').val(newId).trigger('change');
                }
            });
        });
    });

    $('#pathRainForecastDialogPopUp').on('click', function () {
        initSelectId(function (sid) {
            sid.selectId('show', $('#pathRainForecast').val(), function (newId) {
                if (newId) {
                    $('#pathRainForecast').val(newId).trigger('change');
                }
            });
        });
    });

    onChange(false);
    // reinitialize all the Materialize labels on the page if you are dynamically adding inputs:
    // Initialisieren Sie alle Materialise-Beschriftungen auf der Seite neu, wenn Sie dynamisch Eingaben hinzufügen:

    $('.timepicker').timepicker({
        'twelveHour': false
    });

    if (M) M.updateTextFields();

    getAdapterInstances('feiertage', function (instances) {
        fillInstances('publicHolInstance', instances, settings['publicHolInstance']);
    });

    getAdapterInstances('daswetter', function (instances) {
        fillInstances('weatherForInstance', instances, settings['weatherForInstance']);
    });

    getAdapterInstances('telegram', function (instances) {
        fillInstances('telegramInstance', instances, settings['telegramInstance']);
    });

    getAdapterInstances('whatsapp-cmb', function (instances) {
        fillInstances('whatsappInstance', instances, settings['whatsappInstance']);
    });

    getAdapterInstances('email', function (instances) {
        fillInstances('emailInstance', instances, settings['emailInstance']);
    });

    getAdapterInstances('pushover', function (instances) {
        fillInstances('pushoverInstance', instances, settings['pushoverInstance']);
    });

    sendTo(null, 'getTelegramUser', null, function (obj) {
        fillTelegramUser(settings['telegramUser'], obj);
    });
    fillPosition();
}

/**
 * Automatic filling in of astronomical data if the field is empty.
 * Automatisches Ausfüllen von astronomischen Daten, wenn das Feld leer ist.
 */
function fillPosition() {
    socket.emit('getObject', 'system.config', function (err, obj) {
        const $mLongitude = $('#longitude');
        if ($mLongitude.val() === '') {
            $mLongitude.val(obj.common.longitude).trigger('change');
        }
        const $mLatitude = $('#latitude');
        if ($mLatitude.val() === '') {
            $mLatitude.val(obj.common.latitude).trigger('change');
        }
    });
}

/**
 *
 * @param id
 * @param obj
 */
function fillTelegramUser(id, obj) {
    /*let user = str.replace(/[{}"\\]/g,"").split(',');*/
    /*obj = {"0123456789":{"firstName":"Dirk","userName":"Dirk_Peter"}};*/
    const $sel = $('#telegramUser');
    $sel.html('<option value="allTelegramUsers">' + _('All Receiver') + '</option>');
    for(const key in obj){
        if (obj.hasOwnProperty (key)) {
            const names = [];
            let userName;
            obj[key].userName && names.push(obj[key].userName);
            obj[key].firstName && names.push(obj[key].firstName);
            if (obj[key].userName) {
                userName = obj[key].userName;
            } else {
                userName = obj[key].firstName;
            }
            $sel.append('<option value="' + userName + '"' + (id === userName ? ' selected' : '') + '>' + names.join(' / ') +'</option>');
        }
    }
    $sel.select();
}

/**
 *
 * @param {string} id
 * @param arr
 * @param val
 */
function fillInstances(id, arr, val) {
    const $sel = $('#' + id);
    $sel.html('<option value="">' + _('none') + '</option>');
    for (let i = 0; i < arr.length; i++) {
        const _id = arr[i]._id.replace('system.adapter.', '');
        $sel.append('<option value="' + _id + '"' + (_id === val ? ' selected' : '') + '>' + _id + '</option>');
    }
    $sel.select();
}

/**
 *
 */
function tableOnReady() {
    $('#events .table-values-div .table-values .values-buttons[data-command="edit2"]').on('click', function () {
        const id = $(this).data('index');
        initSelectId(function (sid) {
            sid.selectId('show', $('#events .values-input[data-name="name"][data-index="' + id + '"]').val(), function (newId) {
                if (newId) {
                    $('#events .values-input[data-name="name"][data-index="' + id + '"]').val(newId).trigger('change');
                    socket.emit('getObject', newId, function (err, obj) {
                        const name = getName(obj);
                        $('#events .values-input[data-name="sprinkleName"][data-index="' + id + '"]').val(name).trigger('change');
                    });
                }
            });
        });
    });

    $('#events .table-values-div .table-values .values-buttons[data-command="edit"]').on('click', function () {
        const id = $(this).data('index');
        $('#triggerID').val($('#events .values-input[data-name="triggerID"][data-index="' + id + '"]').val());
        $('#wateringTime').val($('#events .values-input[data-name="wateringTime"][data-index="' + id + '"]').val());
        $('#wateringAdd').val($('#events .values-input[data-name="wateringAdd"][data-index="' + id + '"]').val());
        $('#wateringInterval').val($('#events .values-input[data-name="wateringInterval"][data-index="' + id + '"]').val());
        $('#addWateringTime').val($('#events .values-input[data-name="addWateringTime"][data-index="' + id + '"]').val());
        $('#addTriggersIrrigation').val($('#events .values-input[data-name="addTriggersIrrigation"][data-index="' + id + '"]').val());
        $('#maxSoilMoistureIrrigation').val($('#events .values-input[data-name="maxSoilMoistureIrrigation"][data-index="' + id + '"]').val());
        $('#maxSoilMoistureRainPct').val($('#events .values-input[data-name="maxSoilMoistureRainPct"][data-index="' + id + '"]').val());
        $('#triggersIrrigation').val($('#events .values-input[data-name="triggersIrrigation"][data-index="' + id + '"]').val());
        $('#pipeFlow').val($('#events .values-input[data-name="pipeFlow"][data-index="' + id + '"]').val());
        $('#methodControlSM').val($('#events .values-input[data-name="methodControlSM"][data-index="' + id + '"]').val());
        $('#methodControlSM').select().trigger('change');
        $('#triggerSM').val($('#events .values-input[data-name="triggerSM"][data-index="' + id + '"]').val());
        $('#analogZPct').val($('#events .values-input[data-name="analogZPct"][data-index="' + id + '"]').val());
        $('#analogOHPct').val($('#events .values-input[data-name="analogOHPct"][data-index="' + id + '"]').val());
        $('#startDay').val($('#events .values-input[data-name="startDay"][data-index="' + id + '"]').val());
        $('#startDay').select().trigger('change');
        // boolean
        $('#booster').prop('checked', ($('#events .values-input[data-name="booster"][data-index="' + id + '"]')).prop('checked'));
        $('#endIrrigation').prop('checked', ($('#events .values-input[data-name="endIrrigation"][data-index="' +id + '"]')).prop('checked'));
        $('#inGreenhouse').prop('checked', ($('#events .values-input[data-name="inGreenhouse"][data-index="' +id + '"]')).prop('checked'));
        $('#sun').prop('checked', ($('#events .values-input[data-name="sun"][data-index="' +id + '"]')).prop('checked'));
        $('#mon').prop('checked', ($('#events .values-input[data-name="mon"][data-index="' +id + '"]')).prop('checked'));
        $('#tue').prop('checked', ($('#events .values-input[data-name="tue"][data-index="' +id + '"]')).prop('checked'));
        $('#wed').prop('checked', ($('#events .values-input[data-name="wed"][data-index="' +id + '"]')).prop('checked'));
        $('#thur').prop('checked', ($('#events .values-input[data-name="thur"][data-index="' +id + '"]')).prop('checked'));
        $('#fri').prop('checked', ($('#events .values-input[data-name="fri"][data-index="' +id + '"]')).prop('checked'));
        $('#sat').prop('checked', ($('#events .values-input[data-name="sat"][data-index="' +id + '"]')).prop('checked'));

        $('#dialogDeviceEditSprinkle').html($('#events .values-input[data-name="sprinkleName"][data-index="' + id + '"]').val());

        setTimeout(function () {
            initDialogSprinkle(function (sid) {
                const newTriggerID = $('#triggerID').val();
                const newWateringTime = $('#wateringTime').val();
                const newWateringAdd = $('#wateringAdd').val();
                const newWateringInterval = $('#wateringInterval').val();
                const newAddWateringTime = $('#addWateringTime').val();
                const newAddTriggersIrrigation = $('#addTriggersIrrigation').val();
                const newMaxSoilMoistureIrrigation = $('#maxSoilMoistureIrrigation').val();
                const newMaxSoilMoistureRainPct = $('#maxSoilMoistureRainPct').val();
                const newTriggersIrrigation = $('#triggersIrrigation').val();
                const newPipeFlow = $('#pipeFlow').val();
                const newMethodControlSM = $('#methodControlSM').val();
                const newTriggerSM = $('#triggerSM').val();
                const newAnalogZPct = $('#analogZPct').val();
                const newAnalogOHPct = $('#analogOHPct').val();
                const newStartDay = $('#startDay').val();
                // boolean
                const newBooster = $('#booster').prop('checked');
                const newEndIrrigation = $('#endIrrigation').prop('checked');
                const newInGreenhouse = $('#inGreenhouse').prop('checked');
                const newSun = $('#sun').prop('checked');
                const newMon = $('#mon').prop('checked');
                const newTue = $('#tue').prop('checked');
                const newWed = $('#wed').prop('checked');
                const newThur = $('#thur').prop('checked');
                const newFri = $('#fri').prop('checked');
                const newSat = $('#sat').prop('checked');

                $('#events .values-input[data-name="triggerID"][data-index="' + id + '"]').val(newTriggerID).trigger('change');
                $('#events .values-input[data-name="wateringTime"][data-index="' + id + '"]').val(newWateringTime).trigger('change');
                $('#events .values-input[data-name="wateringAdd"][data-index="' + id + '"]').val(newWateringAdd).trigger('change');
                $('#events .values-input[data-name="wateringInterval"][data-index="' + id + '"]').val(newWateringInterval).trigger('change');
                $('#events .values-input[data-name="addWateringTime"][data-index="' + id + '"]').val(newAddWateringTime).trigger('change');
                $('#events .values-input[data-name="addTriggersIrrigation"][data-index="' + id + '"]').val(newAddTriggersIrrigation).trigger('change');
                $('#events .values-input[data-name="maxSoilMoistureIrrigation"][data-index="' + id + '"]').val(newMaxSoilMoistureIrrigation).trigger('change');
                $('#events .values-input[data-name="maxSoilMoistureRainPct"][data-index="' + id + '"]').val(newMaxSoilMoistureRainPct).trigger('change');
                $('#events .values-input[data-name="triggersIrrigation"][data-index="' + id + '"]').val(newTriggersIrrigation).trigger('change');
                $('#events .values-input[data-name="pipeFlow"][data-index="' + id + '"]').val(newPipeFlow).trigger('change');
                $('#events .values-input[data-name="methodControlSM"][data-index="' + id + '"]').val(newMethodControlSM).trigger('change');
                $('#events .values-input[data-name="triggerSM"][data-index="' + id + '"]').val(newTriggerSM).trigger('change');
                $('#events .values-input[data-name="analogZPct"][data-index="' + id + '"]').val(newAnalogZPct).trigger('change');
                $('#events .values-input[data-name="analogOHPct"][data-index="' + id + '"]').val(newAnalogOHPct).trigger('change');
                $('#events .values-input[data-name="startDay"][data-index="' + id + '"]').val(newStartDay).trigger('change');
                // boolean
                $('#events .values-input[data-name="booster"][data-index="' + id + '"]').prop('checked',newBooster);
                $('#events .values-input[data-name="endIrrigation"][data-index="' + id + '"]').prop('checked',newEndIrrigation);
                $('#events .values-input[data-name="inGreenhouse"][data-index="' + id + '"]').prop('checked',newInGreenhouse);
                $('#events .values-input[data-name="sun"][data-index="' + id + '"]').prop('checked',newSun);
                $('#events .values-input[data-name="mon"][data-index="' + id + '"]').prop('checked',newMon);
                $('#events .values-input[data-name="tue"][data-index="' + id + '"]').prop('checked',newTue);
                $('#events .values-input[data-name="wed"][data-index="' + id + '"]').prop('checked',newWed);
                $('#events .values-input[data-name="thur"][data-index="' + id + '"]').prop('checked',newThur);
                $('#events .values-input[data-name="fri"][data-index="' + id + '"]').prop('checked',newFri);
                $('#events .values-input[data-name="sat"][data-index="' + id + '"]').prop('checked',newSat);

            });
        }, 20);
    });
}

/**
 * This will be called by the admin adapter when the user presses the Save or Save and Close button
 * Dies wird vom Admin-Adapter aufgerufen, wenn der Benutzer die Schaltfläche Speichern oder Speichern und Schließen drückt
 * @param {object} callback - JSON object which holds keys and their values that will be written to adapter config object
 *                          - JSON-Objekt, das Schlüssel und deren Werte enthält, die in das Adapterkonfigurationsobjekt geschrieben werden
 */
function save(callback) {
    // example: select elements with class=value and build settings object
    // Beispiel: Wählen Sie Elemente mit class = value aus und erstellen Sie das Einstellungsobjekt
    const obj = {};
    $('#mainSettings .value').each(function () {
        const $this = $(this);
        if ($this.attr('type') === 'checkbox') {
            obj[$this.attr('id')] = $this.prop('checked');
        } else if ($this.attr('type') === 'number') {
            obj[$this.attr('id')] = parseFloat($this.val());
        } else {
            obj[$this.attr('id')] = $this.val();
        }
    });

    // Get edited table
    obj.events    = table2values('events'); //es wird nicht devices abgespeichert, sondern der Inhalt der Tabelle (all Zeilen müssen value="" haben)


    callback(obj);
}

/**
 * Show and hide the display depending on the events
 *
 * Anzeige je nach Ereignissen ein- und ausblenden
 * @param callback
 */
function showHideSettings(callback) {
    /** additional irrigation activated =>
     * zusätzliche Bewässerung aktiviert
     * @type {boolean}
     */
    let selAddStartTime = false;

    // Zeiteinstellungen => Feiertagseinstellung sichtbar bei combobox
    $('#wateringStartTime').on('change', function () {
        if ($(this).val() === 'livingTime') {                   /*Start zur festen Zeit*/
            $('.visTimeShift').hide();
            $('.visWeekLiving').show();
        } else if ($(this).val() === 'livingSunrise') {         /*Start mit Sonnenaufgang*/
            $('.visTimeShift').show();
            $('.visWeekLiving').hide();
        } else if ($(this).val() === 'livingGoldenHourEnd') {   /*Start mit dem Ende der Golden hour*/
            $('.visTimeShift').hide();
            $('.visWeekLiving').hide();
        } else if ($(this).val() === 'livingSunset') {         /*Start mit Sonnenaufgang*/
            $('.visTimeShift').show();
            $('.visWeekLiving').hide();
        }
    }).trigger('change');

    // Pumpeneinstellungen → Zisterne sichtbar bei checkbox
    if ($('#cisternSettings').prop('checked')) {
        $('.cisternObjekt').show();
    } else {
        $('.cisternObjekt').hide();
    }


    // Additional start time => sichtbar je nach auswahl
    $('#selectAddStartTime').on('change',function(){
        if ($(this).val() === 'noAddStartTime') {
            selAddStartTime = false;
            $('.showGreaterETpCur').hide();
            $('.showAddStartTime').hide();
            $('.showExtSig').hide();
        } else if ($(this).val() === 'greaterETpCurrent') {
            selAddStartTime = true;
            $('.showGreaterETpCur').show();
            $('.showAddStartTime').show();
            $('.showExtSig').hide();
        } else if ($(this).val() === 'withExternalSignal') {
            selAddStartTime = true;
            $('.showGreaterETpCur').hide();
            $('.showAddStartTime').show();
            $('.showExtSig').show();
        } else {
            selAddStartTime = false;
            $('.showGreaterETpCur').hide();
            $('.showAddStartTime').hide();
            $('.showExtSig').hide();
        }
    }).trigger('change');

    // Zeiteinstellungen => Feiertagseinstellung sichtbar bei checkbox
    const mPublicWeekend = $('#publicWeekend').prop('checked');
    if (mPublicWeekend) {
        $('.publicWeek').show();
        $('.publicWeekHol').show();
    } else {
        $('.publicWeek').hide();
        $('.publicWeekHol').hide();
    }

    if ($('#publicHolidays').prop('checked') && mPublicWeekend) {
        $('.publicHol').show();
    } else {
        $('.publicHol').hide();
    }

    // zusätzliche Einstellungen => Wettervorhersage
    const mWeatherForecast = $('#weatherForecast').prop('checked');
    if (mWeatherForecast) {
        $('.weatherFor').show();
    } else {
        $('.weatherFor').hide();
    }

    // individuelle Wettervorhersage
    $('#weatherForecastService').on('change', function () {
        if ($(this).val() === 'ownDataPoint') {
            $('.showOwnDataPoint').show();
            $('.showDasWetter').hide();
        } else if ($(this).val() === 'dasWetter') {
            $('.showOwnDataPoint').hide();
            $('.showDasWetter').show();
        }
    }).trigger('change');

    // Benachrichtigung Karte Ein / Aus
    if ($('#notificationEnabled').prop('checked')) {
        $('.tab-notification').show();
    } else {
        $('.tab-notification').hide();
    }


    // Benachrichtigung - Typ auswahl
    $('#notificationsType').on('change', function () {
        if ($(this).val() === 'Telegram') {
            $('.email').hide();
            $('.pushover').hide();
            $('.telegram').show();
            $('.whatsapp').hide();
        } else if ($(this).val() === 'E-Mail') {
            $('.email').show();
            $('.telegram').hide();
            $('.pushover').hide();
            $('.whatsapp').hide();
        } else if ($(this).val() === 'Pushover') {
            $('.pushover').show();
            $('.telegram').hide();
            $('.email').hide();
            $('.whatsapp').hide();
        } else if ($(this).val() === 'WhatsApp') {
            $('.whatsapp').show();
            $('.telegram').hide();
            $('.email').hide();
            $('.pushover').hide();
        }
    }).trigger('change');

    // Sensorauswahl in Sprinkler - Main settings
    $('#methodControlSM').on('change',function(){

        if ($(this).val() === 'calculation') {
            if (selAddStartTime) {
                $('.showAddWateringTime').show();
                $('.showAddTriggersIrrigation').hide();
            }else{
                $('.showAddWateringTime').hide();
                $('.showAddTriggersIrrigation').hide();
            }
            $('.visInGreenhouse').show();
            $('.visSensor').hide();
            $('.visAnalog').hide();
            $('.visCalculation').show();
            $('.visNotAnalog').show();
            $('.visFixDay').hide();

        } else if ($(this).val() === 'bistable') {
            if (mWeatherForecast) {
                $('.visInGreenhouse').show();
            } else {
                $('.visInGreenhouse').hide();
            }
            if (selAddStartTime) {
                $('.showAddWateringTime').show();
                $('.showAddTriggersIrrigation').hide();
            }else{
                $('.showAddWateringTime').hide();
                $('.showAddTriggersIrrigation').hide();
            }
            $('.visSensor').show();
            $('.visAnalog').hide();
            $('.visCalculation').hide();
            $('.visNotAnalog').hide();
            $('.visFixDay').hide();

        } else if ($(this).val() === 'analog') {
            if (mWeatherForecast) {
                $('.visInGreenhouse').show();
            } else {
                $('.visInGreenhouse').hide();
            }
            if (selAddStartTime) {
                $('.showAddWateringTime').show();
                $('.showAddTriggersIrrigation').show();
            }else{
                $('.showAddWateringTime').hide();
                $('.showAddTriggersIrrigation').hide();
            }
            $('.visSensor').show();
            $('.visAnalog').show();
            $('.visCalculation').hide();
            $('.visNotAnalog').show();
            $('.visFixDay').hide();

        } else if ($(this).val() === 'fixDay') {
            if (mWeatherForecast) {
                $('.visInGreenhouse').show();
            } else {
                $('.visInGreenhouse').hide();
            }
            if (selAddStartTime) {
                $('.showAddWateringTime').show();
                $('.showAddTriggersIrrigation').hide();
            }else{
                $('.showAddWateringTime').hide();
                $('.showAddTriggersIrrigation').hide();
            }
            $('.visSensor').hide();
            $('.visAnalog').hide();
            $('.visCalculation').hide();
            $('.visNotAnalog').hide();
            $('.visFixDay').show();
        } else {
            $(this).val('calculation');
            if (selAddStartTime) {
                $('.showAddWateringTime').show();
                $('.showAddTriggersIrrigation').show();
            }else{
                $('.showAddWateringTime').hide();
                $('.showAddTriggersIrrigation').hide();
            }
            $('.visInGreenhouse').show();
            $('.visSensor').hide();
            $('.visAnalog').hide();
            $('.visCalculation').show();
            $('.visNotAnalog').show();
            $('.visFixDay').hide();
        }
    }).trigger('change');

    // Wochentags-Auswahl in Sprinkler - Main settings
    $('#startDay').on('change', function () {
        if (($(this).val() === 'fixDay')) {
            $('.visFixDaysWeek').show();
        } else {
            $('.visFixDaysWeek').hide();
        }
    }).trigger('change');
}

let selectId;

/**
 *
 * @param {object} callback
 * @returns {*}
 */
function initSelectId(callback) {
    if (selectId) {
        return callback(selectId);
    }
    socket.emit('getObjects', function (err, objs) {
        selectId = $('#dialog-select-member').selectId('init',  {
            noMultiselect: true,
            objects: objs,
            imgPath:       '../../lib/css/fancytree/',
            filter:        {type: 'state'},
            name:          'scenes-select-state',
            texts: {
                select:          _('Select'),
                cancel:          _('Cancel'),
                all:             _('All'),
                id:              _('ID'),
                name:            _('Name'),
                role:            _('Role'),
                room:            _('Room'),
                value:           _('Value'),
                selectid:        _('Select ID'),
                from:            _('From'),
                lc:              _('Last changed'),
                ts:              _('Time stamp'),
                wait:            _('Processing...'),
                ack:             _('Acknowledged'),
                selectAll:       _('Select all'),
                unselectAll:     _('Deselect all'),
                invertSelection: _('Invert selection')
            },
            columns: ['image', 'name', 'role', 'room']
        });
        callback(selectId);
    });
}

/**
 *
 * @param obj
 * @returns {string|*}
 */
function getName(obj) {
    if (obj && obj.common && obj.common.name) {
        let name = obj.common.name;
        if (typeof name === 'object') {
            name = name[systemLang] || name.en;
        }
        return name;
    } else if (obj && obj.name) {
        let name = obj.name;
        if (typeof name === 'object') {
            name = name[systemLang] || name.en;
        }
        return name;
    } else {
        const parts = obj.id.split('.');
        const last = parts.pop();
        return last[0].toUpperCase() + last.substring(1).toLowerCase();
    }
}

/**
 *
 * @param callback
 */
function initDialogSprinkle(callback) {
    const $editDialog = $('#dialog-sprinkle-edit');
    if (!$editDialog.data('inited')) {
        $editDialog.data('inited', true);
        $editDialog.modal({
            dismissible: false
        });

        $editDialog.find('.btn-set').on('click', function () {
            const $editDialog = $('#dialog-sprinkle-edit');
            const callback = $editDialog.data('callback');
            if (typeof callback === 'function') callback();
            $editDialog.data('callback', null);
        });
    }
    $editDialog.data('callback', callback);
    $editDialog.modal('open');
}