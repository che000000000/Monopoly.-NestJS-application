import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PregameRoom } from 'src/models/pregame-room.model';
import { UsersService } from '../users/users.service';
import { ChatsService } from '../chats/chats.service';
import { ChatMembersService } from '../chat-members/chat-members.service';
import { InitRoomDto } from './dto/init-room.dto';
import { TiedTo } from 'src/models/chat.model';
import { FindRoomMembersDto } from './dto/find-room-members.dto';
import { UpdateOwnerIdDto } from './dto/update-owner-id.dto';
import { RemoveRoomDto } from './dto/remove-room.dto';
import { AppointNewOwnerDto } from './dto/appiont-new-owner.dto';
import { RemoveUserFromRoomDto } from './dto/remove-user-from-room.dto';
import { JoinUserToRoom } from './dto/join-user-to-room.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { KickUserFromRoomDto } from './dto/kick-user-from-room.dto';
import { RoomsPageItem } from './interfaces/rooms-page.interface';
import { GetRoomsPageDto } from './dto/get-rooms-page.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from '../messages/messages.service';
import { GetRoomMessagesPageDto } from './dto/get-room-messages-page.dto';
import { FormattedUser } from '../users/interfaces/formatted-user.interface';
import { FormattedMessage } from '../messages/interfaces/formated-message.interface';
import { FormattedRoom } from './interfaces/formatted-room.interface';

@Injectable()
export class PregameRoomsService {
    constructor(
        @InjectModel(PregameRoom) private readonly pregameRoomsRepository: typeof PregameRoom,
        private readonly usersService: UsersService,
        private readonly chatsService: ChatsService,
        private readonly chatMembersService: ChatMembersService,
        private readonly messagesService: MessagesService
    ) { }

    async findRoom(roomId: string): Promise<PregameRoom | null> {
        return await this.pregameRoomsRepository.findOne({
            where: { id: roomId },
            raw: true
        })
    }

    async getRoom(roomId: string): Promise<PregameRoom> {
        const foundRoom = await this.findRoom(roomId)
        if (!foundRoom) throw new BadRequestException(`Room doesn't exist.`)
        return foundRoom
    }

    async findRoomByUserId(userId: string): Promise<PregameRoom | null> {
        const foundUser = await this.usersService.findUser(userId)
        if (!foundUser) return null

        return await this.pregameRoomsRepository.findOne({
            where: { id: foundUser.pregameRoomId },
            raw: true
        })
    }

    async getRoomByUserId(userId: string): Promise<PregameRoom> {
        const foundRoom = await this.findRoomByUserId(userId)
        if (!foundRoom) throw new BadRequestException(`Room doesn't exist.`)
        return foundRoom
    }

    async updateOwnerId(dto: UpdateOwnerIdDto): Promise<number> {
        const [affectedCount] = await this.pregameRoomsRepository.update(
            { ownerId: dto.newOwnerId },
            { where: { id: dto.roomId } }
        )
        return affectedCount
    }

    async getRoomMembers(dto: FindRoomMembersDto): Promise<FormattedUser[]> {
        const [recievedRoom, foundMembers] = await Promise.all([
            this.getRoom(dto.roomId),
            this.usersService.findPregameRoomUsers({
                roomId: dto.roomId
            })
        ])

        if (foundMembers.length === 0) throw new NotFoundException(`Room members not found`)
        return foundMembers.map(user => ({
            id: user.id,
            name: user.name,
            avatarUrl: user.avatarUrl ?? null,
            isOwner: recievedRoom.ownerId === user.id ? true : false,
            role: user.role
        }))
    }

    async getRooms(dto: GetRoomsPageDto): Promise<PregameRoom[]> {
        return await this.pregameRoomsRepository.findAll({
            order: [['createdAt', 'DESC']],
            limit: dto.pageSize,
            offset: (dto.pageNumber - 1) * dto.pageSize,
            raw: true
        })
    }

    async getRoomsPage(dto: GetRoomsPageDto): Promise<{ roomsPage: RoomsPageItem[], totalCount: number }> {
        const receivedRooms = await this.getRooms({
            pageSize: dto.pageSize ?? 12,
            pageNumber: dto.pageNumber ?? 1
        })

        const totalCount = await this.pregameRoomsRepository.count()

        const roomsPage = await Promise.all(
            receivedRooms.map(async (room) => {
                const roomMembers = await this.getRoomMembers({ roomId: room.id })

                return {
                    id: room.id,
                    members: roomMembers,
                    createdAt: room.createdAt
                }
            })
        )

        return {
            roomsPage,
            totalCount
        }
    }

    async getRoomMessagesPage(dto: GetRoomMessagesPageDto): Promise<{ messagesPage: FormattedMessage[], totalCount: number }> {
        const foundRoom = await this.findRoomByUserId(dto.userId)
        if (!foundRoom) throw new BadRequestException(`User isn't in the pregame room.`)

        const chatMessages = await this.messagesService.getChatMessages({
            chatId: foundRoom.chatId,
            pageSize: dto.pageSize ?? 12,
            pageNumber: dto.pageNumber ?? 1
        })

        const totalCount = await this.messagesService.getChatMessagesCount({
            chatId: foundRoom.chatId
        })

        const messagesPage = await Promise.all(
            chatMessages.map(async (message) => {
                const userSender = await this.usersService.findUser(message.userId)

                return {
                    id: message.id,
                    text: message.text,
                    sender: userSender ? {
                        id: userSender.id,
                        name: userSender.name,
                        avatarUrl: userSender.avatarUrl,
                        isOwner: foundRoom.ownerId === userSender.id ? true : false,
                        role: userSender.role
                    } : null,
                    createdAt: message.createdAt
                }
            }),
        )

        return {
            messagesPage,
            totalCount
        }
    }

    async initRoom(dto: InitRoomDto): Promise<FormattedRoom> {
        const receivedUser = await this.usersService.getUser(dto.userId)

        const newChat = await this.chatsService.createChat({
            tiedTo: TiedTo.PREGAME
        })

        if (!newChat) throw new InternalServerErrorException(`Chat not created.`)

        const [newRoom] = await Promise.all([
            this.pregameRoomsRepository.create({
                ownerId: receivedUser.id,
                chatId: newChat.id
            }),
            this.chatMembersService.createMember({
                userId: receivedUser.id,
                chatId: newChat.id
            })
        ])

        await this.usersService.updatePregameRoomId({
            userId: receivedUser.id,
            newRoomId: newRoom.id
        })

        return {
            id: newRoom.id,
            createdAt: newRoom.createdAt
        }
    }

    async removeUserFromRoom(dto: RemoveUserFromRoomDto): Promise<FormattedUser> {
        const [receivedUser, foundRoom] = await Promise.all([
            this.usersService.getUser(dto.userId),
            this.findRoomByUserId(dto.userId),
        ])
        if (!foundRoom) throw new BadRequestException(`User isn't in the pregameRoom.`)

        await Promise.all([
            this.chatMembersService.deleteMember({
                userId: dto.userId,
                chatId: foundRoom?.chatId
            }),
            this.usersService.updatePregameRoomId({
                userId: dto.userId,
                newRoomId: null
            })
        ])

        return {
            id: receivedUser.id,
            name: receivedUser.name,
            avatarUrl: receivedUser.avatarUrl ?? null,
            role: receivedUser.role
        }
    }

    async removeRoom(dto: RemoveRoomDto): Promise<FormattedRoom> {
        const pregameRoom = await this.getRoom(dto.roomId)

        await this.chatsService.deleteChat({
            chatId: pregameRoom.chatId
        })

        return {
            id: pregameRoom.id,
            createdAt: pregameRoom.createdAt
        }
    }

    async appointNewOwner(dto: AppointNewOwnerDto): Promise<FormattedUser> {
        const [receivedRoom, roomMembers] = await Promise.all([
            this.getRoom(dto.roomId),
            this.usersService.findPregameRoomUsers({
                roomId: dto.roomId
            })
        ])
        if (roomMembers.length === 0) throw new InternalServerErrorException(`Room is empty. Can't appoint new owner.`)

        const randomIndex = Math.floor(Math.random() * roomMembers.length)
        const newOwner = roomMembers[randomIndex]

        await this.updateOwnerId({
            roomId: receivedRoom.id,
            newOwnerId: newOwner.id
        })

        return {
            id: newOwner.id,
            name: newOwner.name,
            avatarUrl: newOwner.avatarUrl,
            role: newOwner.role
        }
    }

    async createRoom(dto: CreateRoomDto): Promise<{ newRoom: FormattedRoom, roomMembers: FormattedUser[] }> {
        const [receivedUser, foundRoom] = await Promise.all([
            this.usersService.getUser(dto.userId),
            this.findRoomByUserId(dto.userId)
        ])
        
        if (foundRoom) throw new BadRequestException(`User is already in the room.`)

        const newRoom = await this.initRoom({
            userId: receivedUser.id
        })

        const roomMembers = await this.getRoomMembers({
            roomId: newRoom.id
        })

        return {
            newRoom,
            roomMembers
        }
    }

    async joinUserToRoom(dto: JoinUserToRoom): Promise<{ joinedUser: FormattedUser, pregameRoom: FormattedRoom }> {
        const [receivedUser, receivedRoom] = await Promise.all([
            this.usersService.getUser(dto.userId),
            this.getRoom(dto.roomId)
        ])
        if (receivedUser.pregameRoomId) throw new BadRequestException(`User is already in the room.`)

        await Promise.all([
            this.chatMembersService.createMember({
                userId: receivedUser.id,
                chatId: receivedRoom.chatId
            }),
            this.usersService.updatePregameRoomId({
                userId: receivedUser.id,
                newRoomId: receivedRoom.id
            })
        ])

        return {
            joinedUser: {
                id: receivedUser.id,
                name: receivedUser.name,
                avatarUrl: receivedUser.avatarUrl ?? null,
                role: receivedUser.role
            },
            pregameRoom: {
                id: receivedRoom.id,
                createdAt: receivedRoom.createdAt
            }
        }
    }

    async kickUserFromRoom(dto: KickUserFromRoomDto): Promise<{ kickedUser: FormattedUser, pregameRoom: FormattedRoom }> {
        const [receivedKickedUser, foundRoom] = await Promise.all([
            this.usersService.getUser(dto.kickedUserId),
            this.getRoomByUserId(dto.userId),
        ])
        if (receivedKickedUser.id === dto.userId) throw new BadRequestException(`Trying to kick yourself.`)
        if (foundRoom.id !== receivedKickedUser.pregameRoomId) throw new BadRequestException(`Kicked user not in this room.`)
        if (foundRoom.ownerId !== dto.userId) throw new BadRequestException(`Not enough rights to kick user from room.`)

        const kickedUser = await this.removeUserFromRoom({
            userId: receivedKickedUser.id
        })

        return {
            pregameRoom: {
                id: foundRoom.id,
                createdAt: foundRoom.createdAt
            },
            kickedUser
        }
    }

    async sendMessage(dto: SendMessageDto): Promise<{ sentMessage: FormattedMessage, pregameRoom: FormattedRoom }> {
        const recivedUser = await this.usersService.getUser(dto.userId)
        if (!recivedUser.pregameRoomId) throw new BadRequestException(`User isn't in the room.`)

        const recievedRoom = await this.getRoom(recivedUser.pregameRoomId)

        const newMessage = await this.messagesService.createMessage({
            userId: recivedUser.id,
            chatId: recievedRoom.chatId,
            messageText: dto.messageText
        })

        return {
            sentMessage: {
                id: newMessage.id,
                text: newMessage.text,
                sender: {
                    id: recivedUser.id,
                    name: recivedUser.name,
                    avatarUrl: recivedUser.avatarUrl,
                    isOwner: recievedRoom.ownerId === recivedUser.id ? true : false,
                    role: recivedUser.role
                },
                createdAt: newMessage.createdAt
            },
            pregameRoom: {
                id: recievedRoom.id,
                createdAt: recievedRoom.createdAt
            }
        }
    }
}