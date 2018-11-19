'use strict'

/**
 * adonis-websocket-wechatmp
 * George Borrelli
 * 
 * Forked from adonis-websocket-client
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

import Emitter from 'emittery'
import { stringify } from 'query-string'
import wsp from '@adonisjs/websocket-packet'
import Socket from '../Socket/index.js'
import JsonEncoder from '../JsonEncoder/index.js'
import btoa from 'btoa'

/**
 * Connection class is used to make a TCP/Socket connection
 * with the server. It relies on Native Websocket browser
 * support.
 *
 * @class Connection
 *
 * @param {String} url
 * @param {Object} options
 */
export default class Connection extends Emitter {
  constructor (url, options) {
    super()

    /**
     * Connection options
     *
     * @type {Object}
     */
    this.options = Object.assign({
      path: 'adonis-ws',
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      query: null,
      encoder: JsonEncoder,
      env: 'development'
    }, options)

    if (this.options.env !== 'production') {
      console.log('connection options ', this.options)
    }

    /**
     * The state connection is in
     *
     * @type {String}
     */
    this._connectionState = 'idle'

    /**
     * Number of reconnection attempts being made
     *
     * @type {Number}
     */
    this._reconnectionAttempts = 0

    /**
     * All packets are sent in sequence to the server. So we need to
     * maintain a queue and process one at a time
     *
     * @type {Array}
     */
    this._packetsQueue = []

    /**
     * Whether or not the queue is in process
     *
     * @type {Boolean}
     */
    this._processingQueue = false

    /**
     * As per Adonis protocol, the client must ping
     * the server after x interval
     *
     * @type {Timer}
     */
    this._pingTimer = null

    /**
     * Extended query is merged with the query params
     * user pass
     *
     * @type {Object}
     */
    this._extendedQuery = {}

    /**
     * Base URL for the websocket connection
     *
     * @type {String}
     */
    this._url = `${url.replace(/\/$/, '')}/${this.options.path}`

    /**
     * Subscriptions for a single connection
     *
     * @type {Object}
     */
    this.subscriptions = {}

    /**
     * Handler called when `close` is emitted from the
     * subscription
     */
    this.removeSubscription = ({ topic }) => {
      delete this.subscriptions[topic]
    }
  }

  /**
   * Computed value to decide, whether or not to reconnect
   *
   * @method shouldReconnect
   *
   * @return {Boolean}
   */
  get shouldReconnect () {
    return this._connectionState !== 'terminated' &&
    this.options.reconnection &&
    this.options.reconnectionAttempts > this._reconnectionAttempts
  }

  /**
   * Clean references
   *
   * @method _cleanup
   *
   * @return {void}
   *
   * @private
   */
  _cleanup () {
    clearInterval(this._pingTimer)
    this.ws = null
    this._pingTimer = null
  }

  /**
   * Calls a callback passing subscription to it
   *
   * @method _subscriptionsIterator
   *
   * @param  {Function}             callback
   *
   * @return {void}
   *
   * @private
   */
  _subscriptionsIterator (callback) {
    Object.keys(this.subscriptions).forEach((sub) => callback(this.subscriptions[sub], sub))
  }

  /**
   * Calls the callback when there is a subscription for
   * the topic mentioned in the packet
   *
   * @method _ensureSubscription
   *
   * @param  {Object}            packet
   * @param  {Function}          cb
   *
   * @return {void}
   *
   * @private
   */
  _ensureSubscription (packet, cb) {
    const socket = this.getSubscription(packet.d.topic)

    if (!socket) {
      if (this.options.env !== 'production') {
        console.log(`cannot consume packet since ${packet.d.topic} topic has no active subscription ${packet}`)
      }
      return
    }

    cb(socket, packet)
  }

  /**
   * Process the packets queue by sending one packet at a time
   *
   * @method _processQueue
   *
   * @return {void}
   *
   * @private
   */
  _processQueue () {
    if (this._processingQueue || !this._packetsQueue.length) {
      return
    }

    /**
     * Turn on the processing flag
     *
     * @type {Boolean}
     */
    this._processingQueue = true

    this.options.encoder.encode(this._packetsQueue.shift(), (error, payload) => {
      if (error) {
        if (this.options.env !== 'production') {
          console.log(`encode error ${error}`)
        }
        return
      }
      this.write(payload)

      /**
       * Turn off the processing flag and re call the processQueue to send
       * the next message
       *
       * @type {Boolean}
       */
      this._processingQueue = false
      this._processQueue()
    })
  }

  /**
   * As soon as connection is ready, we start listening
   * for new message
   *
   * @method _onOpen
   *
   * @return {void}
   *
   * @private
   */
  _onOpen () {
    if (this.options.env !== 'production') {
      console.log('opened')
    }
  }

  /**
   * When received connection error
   *
   * @method _onError
   *
   * @param  {Event} event
   *
   * @return {void}
   *
   * @private
   */
  _onError (event) {
    if (this.options.env !== 'production') {
      console.log('error', event)
    }

    this._subscriptionsIterator((subscription) => (subscription.serverError()))
    this.emit('error', event)
  }

  /**
   * Initiates reconnect with the server by moving
   * all subscriptions to pending state
   *
   * @method _reconnect
   *
   * @return {void}
   *
   * @private
   */
  _reconnect () {
    this._reconnectionAttempts++

    this.emit('reconnect', this._reconnectionAttempts)

    setTimeout(() => {
      this._connectionState = 'reconnect'
      this.connect()
    }, this.options.reconnectionDelay * this._reconnectionAttempts)
  }

  /**
   * When connection closes
   *
   * @method _onClose
   *
   * @param  {Event} event
   *
   * @return {void}
   *
   * @private
   */
  _onClose (event) {
    if (this.options.env !== 'production') {
      console.log(`closing from ${this._connectionState} state`)
    }

    this._cleanup()

    /**
     * Force subscriptions to terminate
     */
    this._subscriptionsIterator((subscription) => subscription.terminate())

    this
      .emit('close', this)
      .then(() => {
        this.shouldReconnect ? this._reconnect() : this.clearListeners()
      })
      .catch(() => {
        this.shouldReconnect ? this._reconnect() : this.clearListeners()
      })
  }

  /**
   * When a new message was received
   *
   * @method _onMessage
   *
   * @param  {Event}   event
   *
   * @return {void}
   *
   * @private
   */
  _onMessage (event) {
    this.options.encoder.decode(event.data, (decodeError, packet) => {
      if (decodeError) {
        if (this.options.env !== 'production') {
          console.log('packet dropped, decode error', decodeError)
        }
        return
      }
      this._handleMessage(packet)
    })
  }

  /**
   * Handles the message packet based upon it's type
   *
   * @method _handleMessage
   *
   * @param  {Object}       packet
   *
   * @return {void}
   *
   * @private
   */
  _handleMessage (packet) {
    if (wsp.isOpenPacket(packet)) {
      if (this.options.env !== 'production') {
        console.log('open packet')
      }
      this._handleOpen(packet)
      return
    }

    if (wsp.isJoinAckPacket(packet)) {
      if (this.options.env !== 'production') {
        console.log('join ack packet')
      }
      this._handleJoinAck(packet)
      return
    }

    if (wsp.isJoinErrorPacket(packet)) {
      if (this.options.env !== 'production') {
        console.log('join error packet')
      }
      this._handleJoinError(packet)
      return
    }

    if (wsp.isLeaveAckPacket(packet)) {
      if (this.options.env !== 'production') {
        console.log('leave ack packet')
      }
      this._handleLeaveAck(packet)
      return
    }

    if (wsp.isLeaveErrorPacket(packet)) {
      if (this.options.env !== 'production') {
        console.log('leave error packet')
      }
      this._handleLeaveError(packet)
      return
    }

    if (wsp.isLeavePacket(packet)) {
      if (this.options.env !== 'production') {
        console.log('leave packet')
      }
      this._handleServerLeave(packet)
      return
    }

    if (wsp.isEventPacket(packet)) {
      if (this.options.env !== 'production') {
        console.log('event packet')
      }
      this._handleEvent(packet)
      return
    }

    if (wsp.isPongPacket(packet)) {
      if (this.options.env !== 'production') {
        console.log('pong packet')
      }
      return
    }

    if (this.options.env !== 'production') {
      console.log(`invalid packet type ${packet.t}`)
    }
  }

  /**
   * Emits the open emit and send subscription packets
   * for pre-existing subscriptions
   *
   * @method _handleOpen
   *
   * @param  {Object}    packet
   *
   * @return {void}
   *
   * @private
   */
  _handleOpen (packet) {
    this._connectionState = 'open'
    this.emit('open', packet.d)

    /**
     * Setup a timer to ping the server, telling
     * client is awake
     */
    this._pingTimer = setInterval(() => {
      this.sendPacket(wsp.pingPacket())
    }, packet.d.clientInterval)

    /**
     * Sending packets to make pending subscriptions
     */
    if (this.options.env !== 'production') {
      console.log(`processing pre connection subscriptions ${Object.keys(this.subscriptions)}`)
    }

    this._subscriptionsIterator((subscription) => {
      this._sendSubscriptionPacket(subscription.topic)
    })
  }

  /**
   * Handles the join acknowledgement for a subscription
   *
   * @method _handleJoinAck
   *
   * @param  {Object}       packet
   *
   * @return {void}
   *
   * @private
   */
  _handleJoinAck (packet) {
    this._ensureSubscription(packet, (socket) => socket.joinAck())
  }

  /**
   * Handles the join error for a subscription
   *
   * @method _handleJoinError
   *
   * @param  {Object}         packet
   *
   * @return {void}
   *
   * @private
   */
  _handleJoinError (packet) {
    this._ensureSubscription(packet, (socket, packet) => socket.joinError(packet.d))
  }

  /**
   * Acknowledges the subscription leave
   *
   * @method _handleLeaveAck
   *
   * @param  {Object}        packet
   *
   * @return {void}
   *
   * @private
   */
  _handleLeaveAck (packet) {
    this._ensureSubscription(packet, (socket) => socket.leaveAck())
  }

  /**
   * Handles leave error for a subscription
   *
   * @method _handleLeaveError
   *
   * @param  {Object}          packet
   *
   * @return {void}
   *
   * @private
   */
  _handleLeaveError (packet) {
    this._ensureSubscription(packet, (socket, packet) => socket.leaveError(packet.d))
  }

  /**
   * Handles when server initiates the subscription leave
   *
   * @method _handleServerLeave
   *
   * @param  {Object}           packet
   *
   * @return {void}
   *
   * @private
   */
  _handleServerLeave (packet) {
    this._ensureSubscription(packet, (socket, packet) => socket.leaveAck())
  }

  /**
   * Handles the event packet for a subscription
   *
   * @method _handleEvent
   *
   * @param  {Object}     packet
   *
   * @return {void}
   *
   * @private
   */
  _handleEvent (packet) {
    this._ensureSubscription(packet, (socket, packet) => socket.serverEvent(packet.d))
  }

  /**
   * Sends the subscription packet for a given topic
   *
   * @method sendSubscriptionPacket
   *
   * @param  {String}               topic
   *
   * @return {void}
   *
   * @private
   */
  _sendSubscriptionPacket (topic) {
    if (this.options.env !== 'production') {
      console.log(`initiating subscription for ${topic} topic with server`)
    }
    this.sendPacket(wsp.joinPacket(topic))
  }

  /**
   * Instantiate the websocket connection
   *
   * @method connect
   *
   * @return {void}
   */
  connect () {
    const query = stringify(Object.assign({}, this.options.query, this._extendedQuery))
    const url = query ? `${this._url}?${query}` : this._url

    if (this.options.env !== 'production') {
      console.log(`creating socket connection on ${url}`)
    }

    // Legacy WS implementation
    // this.ws = wx.connectSocket({
    //   url,
    //   // header: {"Authorization": ""} // This fixes WeChat's error on iPhone devices that has test data in the header. They probably still haven't fixed it.
    // })
    // wx.onSocketClose((event) => this._onClose(event))
    // wx.onSocketError((event) => this._onError(event))
    // wx.onSocketOpen((event) => this._onOpen(event))
    // wx.onSocketMessage((event) => this._onMessage(event))

    // The new WeChat Websocket implementation >=1.7.0
    this.ws = wx.connectSocket({ url })
    this.ws.onClose((event) => this._onClose(event))
    this.ws.onError((event) => this._onError(event))
    this.ws.onOpen((event) => this._onOpen(event))
    this.ws.onMessage((event) => this._onMessage(event))
    console.log(this.ws, url)

    return this
  }

  /**
   * Writes the payload on the open connection
   *
   * @method write
   *
   * @param  {String} payload
   *
   * @return {void}
   */
  write (payload) {
    if (this.ws.readyState !== this.ws.OPEN) {
      if (this.options.env !== 'production') {
        console.log('connection is not in open state, current state %s', this.ws.readyState)
      }
      return
    }

    this.ws.send({ data: payload })
  }

  /**
   * Sends a packet by encoding it first
   *
   * @method _sendPacket
   *
   * @param  {Object}    packet
   *
   * @return {void}
   */
  sendPacket (packet) {
    this._packetsQueue.push(packet)
    this._processQueue()
  }

  /**
   * Returns the subscription instance for a given topic
   *
   * @method getSubscription
   *
   * @param  {String}        topic
   *
   * @return {Socket}
   */
  getSubscription (topic) {
    return this.subscriptions[topic]
  }

  /**
   * Returns a boolean telling, whether connection has
   * a subscription for a given topic or not
   *
   * @method hasSubcription
   *
   * @param  {String}       topic
   *
   * @return {Boolean}
   */
  hasSubcription (topic) {
    return !!this.getSubscription(topic)
  }

  /**
   * Create a new subscription with the server
   *
   * @method subscribe
   *
   * @param  {String}  topic
   *
   * @return {Socket}
   */
  subscribe (topic) {
    if (!topic || typeof (topic) !== 'string') {
      throw new Error('subscribe method expects topic to be a valid string')
    }

    if (this.subscriptions[topic]) {
      throw new Error('Cannot subscribe to same topic twice. Instead use getSubscription')
    }

    const socket = new Socket(topic, this)
    socket.on('close', this.removeSubscription)

    /**
     * Storing reference to the socket
     */
    this.subscriptions[topic] = socket

    /**
     * Sending join request to the server, the subscription will
     * be considered ready, once server acknowledges it
     */
    if (this._connectionState === 'open') {
      this._sendSubscriptionPacket(topic)
    }

    return socket
  }

  /**
   * Sends event for a given topic
   *
   * @method sendEvent
   *
   * @param  {String}  topic
   * @param  {String}  event
   * @param  {Mixed}  data
   *
   * @return {void}
   *
   * @throws {Error} If topic or event are not passed
   * @throws {Error} If there is no active subscription for the given topic
   */
  sendEvent (topic, event, data) {
    if (!topic || !event) {
      throw new Error('topic and event name is required to call sendEvent method')
    }

    /**
     * Make sure there is an active subscription for the topic. Though server will
     * bounce the message, there is no point in hammering it
     */
    const subscription = this.getSubscription(topic)
    if (!subscription) {
      throw new Error(`There is no active subscription for ${topic} topic`)
    }

    /**
     * If subscription state is not open, then we should not publish
     * messages.
     *
     * The reason we have this check on connection and not socket,
     * is coz we don't want anyone to use the connection object
     * and send packets, even when subscription is closed.
     */
    if (subscription.state !== 'open') {
      throw new Error(`Cannot emit since subscription socket is in ${this.state} state`)
    }

    if (this.options.env !== 'production') {
      console.log(`sending event on ${topic} topic`)
    }

    this.sendPacket(wsp.eventPacket(topic, event, data))
  }

  /**
   * Use JWT token to authenticate the user
   *
   * @method withJwtToken
   *
   * @param {String} token
   *
   * @chainable
   */
  withJwtToken (token) {
    this._extendedQuery.token = token
    return this
  }

  /**
   * Use basic auth credentials to login the user
   *
   * @method withBasicAuth
   *
   * @param  {String}  username
   * @param  {String}  password
   *
   * @chainable
   */
  withBasicAuth (username, password) {
    this._extendedQuery.basic = btoa(`${username}:${password}`)
    return this
  }

  /**
   * Use personal API token to authenticate the user
   *
   * @method withApiToken
   *
   * @param {String} token
   *
   * @return {String}
   */
  withApiToken (token) {
    this._extendedQuery.token = token
    return this
  }

  /**
   * Forcefully close the connection
   *
   * @method close
   *
   * @return {void}
   */
  close () {
    this._connectionState = 'terminated'
    this.ws.close()
  }
}
