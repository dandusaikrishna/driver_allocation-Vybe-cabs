import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RideStatus } from '../../common/enums/ride-status.enum';
import { Driver } from '../../drivers/entities/driver.entity';

@Entity('rides')
export class Ride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  riderId: string;

  @Column({ type: 'double precision' })
  pickupLatitude: number;

  @Column({ type: 'double precision' })
  pickupLongitude: number;

  @Column({ type: 'enum', enum: RideStatus, default: RideStatus.REQUESTED })
  status: RideStatus;

  @Column({ nullable: true })
  assignedDriverId: string | null;

  @ManyToOne(() => Driver, { nullable: true })
  @JoinColumn({ name: 'assignedDriverId' })
  assignedDriver: Driver | null;

  @Column({ type: 'int', default: 0 })
  allocationRound: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
