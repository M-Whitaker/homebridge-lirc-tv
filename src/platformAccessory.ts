import { CharacteristicEventTypes } from 'homebridge';
import type {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback
} from 'homebridge';

import { LIRC } from './platform.js';
import { LIRCController } from './lirc.js';

import ping from 'net-ping';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LIRCTelevision {
  private tvService: Service;
  private tvSpeakerService: Service | undefined;
  private controller: LIRCController;
  private pollingInterval: NodeJS.Timeout | undefined;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private states = {
    Active: false,
    ActiveIdentifier: 0
  };

  constructor(
    private readonly platform: LIRC,
    private readonly accessory: PlatformAccessory
  ) {
    // Initialize LIRC controller
    this.controller = new LIRCController(
      accessory.context.device.host,
      accessory.context.device.port || 8765,
      accessory.context.device.remote,
      accessory.context.device.delay || 0,
      platform.log
    );
    if (accessory.context.device.ip == null) {
      accessory.context.device.ip = '0.0.0.0';
    }
    // initialise ping interval
    if (accessory.context.device.ip !== '0.0.0.0') {
      this.platform.log.debug('Enabling polling!');
      this.pollingInterval = setInterval(
        this.pingDevice.bind(this),
        accessory.context.device.pollingInterval || 20000
      );
    }

    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        accessory.context.device.manufacturer || 'Unknown'
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        accessory.context.device.model || 'Unknown'
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        accessory.context.device.serial || 'Unknown'
      );

    // get the Television service if it exists, otherwise create a new Television service
    this.tvService =
      this.accessory.getService(this.platform.Service.Television) ??
      this.accessory.addService(this.platform.Service.Television);

    // set the configured name for the Television service, this is what is displayed as the default name on the Home app
    this.tvService.setCharacteristic(
      this.platform.Characteristic.ConfiguredName,
      accessory.context.device.name
    );

    // set sleep discovery characteristic
    this.tvService.setCharacteristic(
      this.platform.Characteristic.SleepDiscoveryMode,
      this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    );

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Television

    // register handlers for the Active Characteristic (on / off events)
    this.tvService
      .getCharacteristic(this.platform.Characteristic.Active)
      .on(CharacteristicEventTypes.SET, this.setActive.bind(this)) // SET - bind to the `setOn` method below
      .on(CharacteristicEventTypes.GET, this.getActive.bind(this)); // GET - bind to the `getOn` method below

    // register handlers for the ActiveIdentifier Characteristic (input events)
    this.tvService
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .on(CharacteristicEventTypes.SET, this.setActiveIdentifier.bind(this)); // SET - bind to the 'setActiveIdentifier` method below

    this.tvService
      .getCharacteristic(this.platform.Characteristic.PowerModeSelection)
      .on(CharacteristicEventTypes.SET, this.setPowerModeSelection.bind(this)); // SET - bind to the 'setPowerModeSelection` method below

    // register handlers for the remote control
    if (accessory.context.device.remoteKeys) {
      // map remote keys to their commands
      const mappedRemoteKeys: { [key: number]: string[] } = {};
      accessory.context.device.remoteKeys.forEach(
        (remoteKey: { type: number; command: string[] }) => {
          mappedRemoteKeys[remoteKey.type] = remoteKey.command;
        }
      );

      this.tvService
        .getCharacteristic(this.platform.Characteristic.RemoteKey)
        .on(
          CharacteristicEventTypes.SET,
          (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            if ((value as number) in mappedRemoteKeys) {
              this.controller
                .sendCommands(mappedRemoteKeys[value as number])
                .then(() => {
                  callback(null);
                })
                .catch((error) => {
                  this.platform.log.error(error);
                  callback(error);
                });
            } else {
              callback(
                new Error(`This RemoteKey has not been configured: ${value}`)
              );
            }
          }
        );
    }

    //

    if (
      accessory.context.device.muteOn &&
      accessory.context.device.muteOff &&
      accessory.context.device.volumeUp &&
      accessory.context.device.volumeDown
    ) {
      // get the Television Speaker service if it exists, otherwise create a new Television Speaker service
      this.tvSpeakerService =
        this.accessory.getService(this.platform.Service.TelevisionSpeaker) ??
        this.accessory.addService(this.platform.Service.TelevisionSpeaker);

      // set the volume control type
      this.tvSpeakerService.setCharacteristic(
        this.platform.Characteristic.VolumeControlType,
        this.platform.Characteristic.VolumeControlType.RELATIVE
      );

      this.tvSpeakerService
        .getCharacteristic(this.platform.Characteristic.Mute)
        .on(CharacteristicEventTypes.SET, this.setMute.bind(this));
      this.tvSpeakerService
        .getCharacteristic(this.platform.Characteristic.VolumeSelector)
        .on(CharacteristicEventTypes.SET, this.setVolume.bind(this));
    }

    // register inputs
    if (accessory.context.device.inputs) {
      if (accessory.context.device.statelessInputs) {
        // accessory.context.device.inputs.unshift({
        //   id: ' ',
        //   name: ' ',
        //   visible: true,
        //   type: 2
        // });
      }
      accessory.context.device.inputs.forEach(
        (
          input: {
            id: string;
            name: string;
            visible: boolean;
            type: number; // See InputSourceType from hap-nodejs
          },
          i: number
        ) => {
          // eslint-disable-next-line eqeqeq
          if (input.visible == null) {
            input.visible = true;
          }
          const inputService = accessory.addService(
            this.platform.Service.InputSource,
            input.name,
            input.name
          );
          inputService
            .setCharacteristic(this.platform.Characteristic.Identifier, i)
            .setCharacteristic(
              this.platform.Characteristic.ConfiguredName,
              input.name
            )
            .setCharacteristic(
              this.platform.Characteristic.IsConfigured,
              this.platform.Characteristic.IsConfigured.CONFIGURED
            )
            .setCharacteristic(
              this.platform.Characteristic.TargetVisibilityState,
              input.visible
                ? this.platform.Characteristic.CurrentVisibilityState.SHOWN
                : this.platform.Characteristic.CurrentVisibilityState.HIDDEN
            )
            .setCharacteristic(
              this.platform.Characteristic.CurrentVisibilityState,
              input.visible
                ? this.platform.Characteristic.CurrentVisibilityState.SHOWN
                : this.platform.Characteristic.CurrentVisibilityState.HIDDEN
            )
            .setCharacteristic(
              this.platform.Characteristic.InputSourceType,
              input.type
            );
          this.tvService.addLinkedService(inputService);
        }
      );
    }
  }

  /**
   * Updating characteristics values asynchronously.
   *
   * Example showing how to update the state of a Characteristic asynchronously instead
   * of using the `on('get')` handlers.
   * Here we change update the motion sensor trigger states on and off every 10 seconds
   * the `updateCharacteristic` method.
   *
   */
  pingDevice(): void {
    const target = this.accessory.context.device.ip;
    let isAlive: boolean = this.states.Active;
    // Default options
    const options = {
      networkProtocol: ping.NetworkProtocol.IPv4,
      packetSize: 16,
      retries: 0,
      sessionId: process.pid % 65535,
      timeout: 2000,
      ttl: 128
    };
    const session = ping.createSession(options);

    session.pingHost(target, (error: any, target: any) => {
      if (error) {
        this.platform.log.debug(target + ': ' + error.toString());
        isAlive = false;
      } else {
        this.platform.log.debug(target + ': Alive');
        isAlive = true;
      }

      if (isAlive !== this.states.Active) {
        this.states.Active = isAlive;
        // push the new value to HomeKit
        this.tvService.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.states.Active
        );
        this.platform.log.debug('Triggering tvService:', this.states.Active);
      }
    });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory.
   */
  setActive(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): void {
    if ((this.states.Active && !value) || (!this.states.Active && value)) {
      // Suspend the ping timer
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }
      this.controller
        .sendCommands(
          value
            ? this.accessory.context.device.powerOn
            : this.accessory.context.device.powerOff
        )
        .then(() => {
          this.tvService.updateCharacteristic(
            this.platform.Characteristic.Active,
            value
          );
          this.states.Active = value as boolean;
          this.platform.log.debug('Set Characteristic Active ->', value);
          callback(null);
        })
        .catch((error) => {
          this.platform.log.error(error);
          callback(error);
        });
      // Restart the ping timer
      if (this.pollingInterval) {
        this.pollingInterval = setInterval(
          this.pingDevice.bind(this),
          this.accessory.context.device.pollingInterval || 20000
        );
      }
    } else {
      this.platform.log.error(
        `Skipped power ${value ? 'on' : 'off'} command since no state change.`
      );
      callback(null);
    }
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.tvService.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getActive(callback: CharacteristicGetCallback): void {
    const isOn = this.states.Active;

    this.platform.log.debug('Get Characteristic On ->', isOn);

    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return
    callback(null, isOn);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory.
   */
  setActiveIdentifier(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): void {
    const thisInput = this.accessory.context.device.inputs[value as number];

    this.controller
      .sendCommands(thisInput.command)
      .then(() => {
        if (this.accessory.context.device.statelessInputs) {
          this.states.ActiveIdentifier = 0;
          setTimeout(() => {
            this.tvService.updateCharacteristic(
              this.platform.Characteristic.ActiveIdentifier,
              0
            );
          }, 1000);
          this.platform.log.debug(
            'Reset Characteristic Active Identifier -> ',
            0
          );
        } else {
          // Store the selected input in state
          this.states.ActiveIdentifier = value as number;
          this.platform.log.debug(
            'Set Characteristic Active Identifier -> ',
            value
          );
        }

        // you must call the callback function
        callback(null);
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error);
      });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory. (View TV Settings Button)
   */
  setPowerModeSelection(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): void {
    this.platform.log.debug('Requested tv settings (PowerModeSelection)');
    //TODO: Implement TV Settings
    callback(null);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory.
   */
  setMute(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): void {
    this.controller
      .sendCommands(
        value
          ? this.accessory.context.device.muteOn
          : this.accessory.context.device.muteOff
      )
      .then(() => {
        this.platform.log.debug('Set Mute Active ->', value);
        callback(null);
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error);
      });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory.
   */
  setVolume(
    value: CharacteristicValue,
    callback: CharacteristicSetCallback
  ): void {
    this.controller
      .sendCommands(
        value
          ? this.accessory.context.device.volumeDown
          : this.accessory.context.device.volumeUp
      )
      .then(() => {
        this.platform.log.debug('Set Vol ->', value);
        callback(null);
      })
      .catch((error) => {
        this.platform.log.error(error);
        callback(error);
      });
  }
}
