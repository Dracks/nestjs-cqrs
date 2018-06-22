import { IEventBus, IEvent, IEventHandler, ICommand } from './interfaces/index';
import { ObservableBus } from './utils/observable-bus';
import { Injectable, Type } from '@nestjs/common';
import { EventObservable } from './interfaces/event-observable.interface';
import { Observable } from 'rxjs';
import { CommandBus } from './command-bus';
import { InvalidSagaException } from './exceptions/invalid-saga.exception';
import { EVENTS_HANDLER_METADATA } from './utils/constants';
import { InvalidModuleRefException, Saga } from './index';
import { filter } from 'rxjs/operators';
import { IEventPublisher } from './interfaces/events/event-publisher.interface';
import { DefaultPubSub } from './utils/default-pubsub';

export type EventHandlerMetatype = Type<IEventHandler<IEvent>>;

@Injectable()
export class EventBus extends ObservableBus<IEvent> implements IEventBus {
  private moduleRef = null;
  private _publisher: IEventPublisher;

  constructor(private readonly commandBus: CommandBus) {
    super();
    this.useDefaultPublisher();
  }

  private useDefaultPublisher() {
    const pubSub = new DefaultPubSub();
    pubSub.bridgeEventsTo(this.subject$);
    this._publisher = pubSub;
  }

  setModuleRef(moduleRef) {
    this.moduleRef = moduleRef;
  }

  publish<T extends IEvent>(event: T) {
    this._publisher.publish(event);
  }

  ofType<T extends IEvent>(event: T & { name: string }) {
    return this.ofEventName(event.name);
  }

  bind<T extends IEvent>(handler: IEventHandler<IEvent>, name: string) {
    const stream$ = name ? this.ofEventName(name) : this.subject$;
    stream$.subscribe(event => handler.handle(event));
  }

  combineSagas(sagas: Saga[]) {
    [].concat(sagas).map(saga => this.registerSaga(saga));
  }

  register(handlers: EventHandlerMetatype[]) {
    handlers.forEach(handler => this.registerHandler(handler));
  }

  protected registerHandler(handler: EventHandlerMetatype) {
    if (!this.moduleRef) {
      throw new InvalidModuleRefException();
    }

    const instance = this.moduleRef.get(handler);
    if (!instance) return;

    const eventsNames = this.reflectEventsNames(handler);
    eventsNames.map(event =>
      this.bind(instance as IEventHandler<IEvent>, event.name),
    );
  }

  protected ofEventName(name: string) {
    return this.subject$.pipe(
      filter(event => this.getEventName(event) === name),
    );
  }

  private getEventName(event): string {
    const { constructor } = Object.getPrototypeOf(event);
    return constructor.name as string;
  }

  protected registerSaga(saga: Saga) {
    const stream$ = saga(this);
    if (!(stream$ instanceof Observable)) {
      throw new InvalidSagaException();
    }
    stream$
      .pipe(filter(e => e))
      .subscribe(command => this.commandBus.execute(command));
  }

  private reflectEventsNames(
    handler: EventHandlerMetatype,
  ): FunctionConstructor[] {
    return Reflect.getMetadata(EVENTS_HANDLER_METADATA, handler);
  }

  get publisher(): IEventPublisher {
    return this._publisher;
  }

  set publisher(thePublisher: IEventPublisher) {
    this._publisher = thePublisher;
  }
}
