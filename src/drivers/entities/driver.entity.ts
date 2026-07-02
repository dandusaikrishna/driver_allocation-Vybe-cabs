import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DriverStatus } from '../../common/enums/driver-status.enum';

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  phone: string;

  @Column({ type: 'enum', enum: DriverStatus, default: DriverStatus.AVAILABLE })
  status: DriverStatus;

  @Column({ type: 'double precision', default: 0 })
  latitude: number;

  @Column({ type: 'double precision', default: 0 })
  longitude: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
