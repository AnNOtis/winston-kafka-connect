"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WinstonKafkaTransport = void 0;
const debug = require("debug")("winstonkafkatransport");
const { KafkaClient, HighLevelProducer } = require("kafka-node");
const Transport = require("winston-transport");
const CircularJSON = require('circular-json');
const _ = require("lodash");
const noop = () => undefined;
const DEFAULTS = {
    topic: "winston-kafka-logs",
    kafkaClient: {
        kafkaHost: "127.0.0.1:9092",
        clientId: "winston-kafka-logger",
        connectTimeout: 10 * 1000,
        requestTimeout: 30 * 1000,
        idleConnection: 5 * 60 * 1000,
        autoConnect: true,
        versions: {
            disabled: false,
            requestTimeout: 500
        },
        connectRetryOptions: {
            retries: 5,
            factor: 2,
            minTimeout: 1 * 1000,
            maxTimeout: 60 * 1000,
            randomize: true
        },
        maxAsyncRequests: 10,
        noAckBatchOptions: null
    },
    producer: {
        partitionerType: 0,
        requireAcks: 1,
        ackTimeoutMs: 100
    },
    highWaterMark: 100,
    onProducerError: null
};
class WinstonKafkaTransport extends Transport {
    constructor(options) {
        super(options);
        this.options = _.defaultsDeep({}, options || {}, DEFAULTS);
        this.timestamp =
            options.timestamp ||
                function () {
                    return Date.now();
                };
        this.connected = false;
        this.jsonformatter = options.jsonformatter || CircularJSON;
        if (options.localstore) {
            debug("mocking producer");
            this.producer = {
                send(payloads, cb) {
                    payloads.forEach(p => {
                        if (!_.isArray(options.localstore[p.topic])) {
                            options.localstore[p.topic] = [];
                        }
                        let messages = _.isArray(p.messages) ? p.messages : [p.messages];
                        options.localstore = [...options.localstore, ...messages];
                        cb(undefined);
                    });
                },
                close(cb) {
                    cb(undefined);
                }
            };
            this.connected = true;
        }
        else {
            debug("piping to kafka stream");
            this.client = new KafkaClient(this.options.kafkaClient);
            this.producer = new HighLevelProducer(this.client, this.options.producer);
            this.producer
                .on("ready", () => {
                this.connected = true;
            })
                .on("error", err => {
                this.connected = false;
                debug(err);
                if (typeof this.options.onProducerError === "function") {
                    this.options.onProducerError(err);
                }
                else {
                    throw new Error(err);
                }
            });
        }
    }
    _sendPayload(payload, callback) {
        callback = typeof callback === "function" ? callback : noop;
        if (!payload) {
            return callback(new Error("Missing required payload."));
        }
        if (!this.connected) {
            debug("waiting for producer...");
            return this.producer.once("ready", () => this.producer.send(payload, callback));
        }
        debug("hasta luego", payload);
        this.producer.send(payload, callback);
    }
    log(message, callback) {
        let payload;
        try {
            message.timestamp = this.timestamp();
            payload = [
                {
                    topic: this.options.topic,
                    messages: [this.jsonformatter.stringify(message)],
                    timestamp: this.timestamp()
                }
            ];
        }
        catch (error) {
            debug(error);
            return callback(error);
        }
        this.emit("logged", payload);
        this._sendPayload(payload, error => {
            if (error) {
                debug(error);
            }
        });
        callback(null, true);
    }
    close(callback) {
        this.connected = false;
        this.producer.close(callback);
    }
}
exports.WinstonKafkaTransport = WinstonKafkaTransport;
//# sourceMappingURL=WinstonKafkaTransport.js.map