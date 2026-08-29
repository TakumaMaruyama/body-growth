export interface Revision<T> { version:number; value:T; reason:string|null }
export interface VersionedRecord<T> {
  status:"ACTIVE"|"VOIDED";
  version:number;
  revisions:Revision<T>[];
}

export function correctRecord<T>(record:VersionedRecord<T>, expectedVersion:number, value:T, reason:string):VersionedRecord<T> {
  if(record.version!==expectedVersion) throw new Error("VERSION_CONFLICT");
  if(record.status!=="ACTIVE") throw new Error("NOT_ACTIVE");
  if(!reason.trim()) throw new Error("REASON_REQUIRED");
  const version=record.version+1;
  return {...record,version,revisions:[...record.revisions,{version,value,reason}]};
}
export function voidRecord<T>(record:VersionedRecord<T>, expectedVersion:number):VersionedRecord<T> {
  if(record.version!==expectedVersion) throw new Error("VERSION_CONFLICT");
  if(record.status!=="ACTIVE") throw new Error("NOT_ACTIVE");
  return {...record,status:"VOIDED",version:record.version+1};
}
export class IdempotencyStore<T> {
  private readonly values=new Map<string,T>();
  execute(key:string,work:()=>T):T {
    if(this.values.has(key)) return this.values.get(key)!;
    const value=work();
    this.values.set(key,value);
    return value;
  }
}