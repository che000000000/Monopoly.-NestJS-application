import { Column, DataType, Default, HasMany, Model, PrimaryKey, Table } from "sequelize-typescript";
import { v4 } from "uuid";
import { Player } from "./player.model";

@Table({ tableName: 'Matches' })
export class Match extends Model {
    @PrimaryKey
    @Column({
        type: DataType.UUID,
        allowNull: false,
        defaultValue: () => v4() 
    })
    declare id: string

    @Column({
        type: DataType.DATE,
        allowNull: false,
    })
    date: Date

    @HasMany(() => Player)
    players: Player[]
}