const exec = require('child_process').exec;
import { Logger } from 'homebridge';

const DELAY_INDENTIFIER = 'DELAY|';

export class LIRCController {
  private sendCommand: (
    key: string,
    resolve: (value?: void | PromiseLike<void> | undefined) => void,
    reject: (reason?: Error) => void
  ) => void;

  public sendCommands = (keys: string[]): Promise<void> => {
    return keys.reduce((collector: Promise<void>, key) => {
      return collector.then(
        () =>
          new Promise((resolve, reject) => {
            this.sendCommand(key, resolve, reject);
          })
      );
    }, Promise.resolve());
  };

  constructor(
    private host: string,
    private port: number,
    private remote: string,
    private delay: number,
    private log: Logger
  ) {
    this.sendCommand = (
      key: string,
      resolve: (value?: void | PromiseLike<void> | undefined) => void,
      reject: (reason?: Error) => void
    ) => {
      if (key.startsWith(DELAY_INDENTIFIER)) {
        // This is just a delay key, no need to send to LIRC
        const delayTimeout = parseInt(key.replace(DELAY_INDENTIFIER, ''));
        this.log.info(`Delaying for ${delayTimeout}ms`);
        setTimeout(resolve, delayTimeout);
      } else {
        const requestBody = `SEND_ONCE ${this.remote} ${key}`;
        this.log.info(
          `Sending command to LIRC (${this.host}:${this.port}): ${requestBody}`
        );
        exec(
          `irsend ${requestBody}`,
          (error: Error, stdout: any, stderr: any) => {
            if (error) {
              this.log.error('Sending command failed...');
              reject(error);
            }
            setTimeout(resolve, this.delay);
            this.log.info('Command Sent...');
          }
        );
      }
    };
  }
}
